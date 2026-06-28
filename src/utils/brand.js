// Network-aware branding. The bot keeps the CO code but runs as USGRP when
// ACTIVE_NETWORK=usgrp — so user-facing branding (embed footers, titles, the
// "Staff Assistant" name, server references) flips with the network key. Route
// every user-facing brand string through BRAND.* so both modes stay correct.
//
// NOTE: "Federal Citizen Network" is the in-game BANK, never the org — the
// network/org is "USGRP" / "United States Government Roleplay".
import { IS_CO } from '../config.js';

const USGRP = {
    name:       'USGRP',
    full:       'United States Government Roleplay',
    short:      'USGRP',
    footer:     'USGRP · Network Administration',
    assistant:  'USGRP Network Assistant',
    servers:    'USGRP servers',
    color:      0x112e51,   // federal navy
    accent:     0xffbe2e,   // federal gold
    logo:       'https://gov.usgrp.xyz/assets/usgrp-logo.png',
};

const CO = {
    name:       'Community Organisation',
    full:       'Community Organisation',
    short:      'CO',
    footer:     'Community Organisation | Staff Assistant',
    assistant:  'Community Organisation | Staff Assistant',
    servers:    'Community Organisation servers',
    color:      0x1a4374,
    accent:     0xffbe2e,
    logo:       '/assets/co-logo.png',
};

export const BRAND = IS_CO ? CO : USGRP;
export default BRAND;
