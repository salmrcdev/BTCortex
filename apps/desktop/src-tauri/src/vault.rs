//! Windows DPAPI protection for secrets.
//!
//! This is native code because DPAPI is a Win32 API with no Node.js binding.
//! Blobs are bound to the current Windows user: other accounts and offline
//! copies of the disk cannot decrypt them. DPAPI does not protect against
//! malware running as the same user, which the security model documents.

use thiserror::Error;

#[derive(Debug, Error)]
pub enum VaultError {
    #[error("Windows could not protect the secret: {0}")]
    Protect(String),
    #[error("Windows could not unprotect the secret: {0}")]
    Unprotect(String),
    #[error("The protected secret is not valid UTF-8 text")]
    NotText,
    #[cfg(not(windows))]
    #[error("Secret protection is only available on Windows")]
    Unsupported,
}

/// Application-specific entropy: blobs produced for BTCortex cannot be
/// decrypted through DPAPI by another program that does not supply it.
#[cfg(windows)]
const ENTROPY: &[u8] = b"BTCortex secret vault v1";

#[cfg(windows)]
mod platform {
    use super::{ENTROPY, VaultError};
    use windows::Win32::Foundation::{HLOCAL, LocalFree};
    use windows::Win32::Security::Cryptography::{
        CRYPT_INTEGER_BLOB, CRYPTPROTECT_UI_FORBIDDEN, CryptProtectData, CryptUnprotectData,
    };
    use windows::core::PCWSTR;

    fn blob(bytes: &[u8]) -> CRYPT_INTEGER_BLOB {
        CRYPT_INTEGER_BLOB {
            cbData: bytes.len() as u32,
            pbData: bytes.as_ptr() as *mut u8,
        }
    }

    /// Copies the system-allocated output and releases it.
    unsafe fn take(output: CRYPT_INTEGER_BLOB) -> Vec<u8> {
        if output.pbData.is_null() {
            return Vec::new();
        }
        // SAFETY: DPAPI returned `cbData` initialised bytes at `pbData`.
        let bytes =
            unsafe { std::slice::from_raw_parts(output.pbData, output.cbData as usize) }.to_vec();
        // SAFETY: the buffer was allocated by DPAPI with LocalAlloc.
        unsafe {
            let _ = LocalFree(Some(HLOCAL(output.pbData.cast())));
        }
        bytes
    }

    pub fn protect(plaintext: &[u8]) -> Result<Vec<u8>, VaultError> {
        let input = blob(plaintext);
        let entropy = blob(ENTROPY);
        let mut output = CRYPT_INTEGER_BLOB::default();
        // SAFETY: input and entropy point to live slices for the duration of the call.
        unsafe {
            CryptProtectData(
                &input,
                PCWSTR::null(),
                Some(&entropy),
                None,
                None,
                CRYPTPROTECT_UI_FORBIDDEN,
                &mut output,
            )
            .map_err(|error| VaultError::Protect(error.message()))?;
            Ok(take(output))
        }
    }

    pub fn unprotect(protected: &[u8]) -> Result<Vec<u8>, VaultError> {
        let input = blob(protected);
        let entropy = blob(ENTROPY);
        let mut output = CRYPT_INTEGER_BLOB::default();
        // SAFETY: as above.
        unsafe {
            CryptUnprotectData(
                &input,
                None,
                Some(&entropy),
                None,
                None,
                CRYPTPROTECT_UI_FORBIDDEN,
                &mut output,
            )
            .map_err(|error| VaultError::Unprotect(error.message()))?;
            Ok(take(output))
        }
    }
}

#[cfg(windows)]
pub fn protect_text(plaintext: &str) -> Result<Vec<u8>, VaultError> {
    platform::protect(plaintext.as_bytes())
}

#[cfg(windows)]
pub fn unprotect_text(protected: &[u8]) -> Result<String, VaultError> {
    String::from_utf8(platform::unprotect(protected)?).map_err(|_| VaultError::NotText)
}

#[cfg(not(windows))]
pub fn protect_text(_plaintext: &str) -> Result<Vec<u8>, VaultError> {
    Err(VaultError::Unsupported)
}

#[cfg(not(windows))]
pub fn unprotect_text(_protected: &[u8]) -> Result<String, VaultError> {
    Err(VaultError::Unsupported)
}

#[cfg(all(test, windows))]
mod tests {
    use super::*;

    #[test]
    fn round_trips_and_never_stores_plaintext() {
        let secret = "correct horse battery staple £";
        let protected = protect_text(secret).expect("protect");
        assert!(
            !protected
                .windows(secret.len())
                .any(|window| window == secret.as_bytes())
        );
        assert_eq!(unprotect_text(&protected).expect("unprotect"), secret);
    }

    #[test]
    fn rejects_tampered_blobs() {
        let mut protected = protect_text("secret").expect("protect");
        let last = protected.len() - 1;
        protected[last] ^= 0xff;
        assert!(unprotect_text(&protected).is_err());
    }
}
