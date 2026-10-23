// Product identity in one place, so that branding can change without touching
// application logic (specification section 2).

export const PRODUCT_NAME = 'BTCortex';
export const PRODUCT_TAGLINE = 'Bitcoin ecosystem command centre';
export const PRODUCT_FULL_NAME = `${PRODUCT_NAME} — ${PRODUCT_TAGLINE}`;

/** Folder name used under %LOCALAPPDATA% for application data. */
export const DATA_FOLDER_NAME = 'BTCortex';

/** Folder name used for development builds, so test data never mixes with real data. */
export const DEV_DATA_FOLDER_NAME = 'BTCortex-dev';
