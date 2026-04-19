// CO brand tokens used by the shared email layout. Duplicated verbatim into
// the bot's src/lib/coBrandEmail.js — if you change a value here, mirror it.
export const CO_BRAND_EMAIL = Object.freeze({
  NAVY:       '#0B1F3A',
  GOLD:       '#C9A84C',
  LIGHT_GOLD: '#F5EDD6',
  LIGHT_GREY: '#F4F5F7',
  DARK_GREY:  '#555555',
  BODY_INK:   '#222222',
  WHITE:      '#FFFFFF',

  // Buttons
  BUTTON_PRIMARY_BG:    '#C9A84C',
  BUTTON_PRIMARY_TEXT:  '#0B1F3A',
  BUTTON_SECONDARY_BG:  '#0B1F3A',
  BUTTON_SECONDARY_TEXT:'#FFFFFF',

  // Callouts
  CALLOUT_INFO_BG:       '#F5EDD6',
  CALLOUT_INFO_BORDER:   '#C9A84C',
  CALLOUT_INFO_TEXT:     '#0B1F3A',
  CALLOUT_WARNING_BG:    '#FEF3C7',
  CALLOUT_WARNING_BORDER:'#B45309',
  CALLOUT_WARNING_TEXT:  '#78350F',
  CALLOUT_SUCCESS_BG:    '#D1FAE5',
  CALLOUT_SUCCESS_BORDER:'#059669',
  CALLOUT_SUCCESS_TEXT:  '#064E3B',
});

export const EMAIL_FONT_STACK = "-apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Helvetica, Arial, sans-serif";

export default CO_BRAND_EMAIL;
