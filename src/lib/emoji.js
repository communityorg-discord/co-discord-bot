// AUTO-GENERATED custom Community Organisation app emojis (blurple/indigo brand).
// Custom emojis render in embed descriptions + field VALUES (not titles/field names).
export const E = {
  processing: '<a:processing:1509040440463327262>',
  acting: '<:acting:1509040402529914880>',
  announce: '<:announce:1509040414454448299>',
  aps: '<:aps:1509040395122774027>',
  ban: '<:ban:1509040365976555611>',
  bot: '<:bot:1509040434268209252>',
  break: '<:break:1509040399610810492>',
  calendar: '<:calendar:1509040419504259112>',
  check: '<:check:1509040352626217000>',
  cross: '<:cross:1509040355167834182>',
  dm: '<:dm:1509040409345786071>',
  gavel: '<:gavel:1509040380887306391>',
  gban: '<:gban:1509040368925147296>',
  id: '<:id:1509040427020451840>',
  inbox: '<:inbox:1509040412180877322>',
  info: '<:info:1509040363292332052>',
  investigate: '<:investigate:1509040375954673796>',
  join: '<:join:1509344021921927421>',
  kudos: '<:kudos:1509040392476295338>',
  leave: '<:leave:1509344024711139469>',
  link: '<:link:1509040422142607471>',
  logs: '<:logs:1509040429088243774>',
  member: '<:member:1509040389544345740>',
  pending: '<:pending:1509040357633953874>',
  role: '<:role:1509040436692516894>',
  seal: '<:seal:1509040347617955911>',
  server: '<:server:1509040431839576174>',
  shield: '<:shield:1509040383542431846>',
  staff: '<:staff:1509040386285244557>',
  standup: '<:standup:1509040397546950776>',
  star: '<:star:1509040350054842468>',
  suspend: '<:suspend:1509040373656457236>',
  terminate: '<:terminate:1509040378358005832>',
  ticket: '<:ticket:1509040417113505812>',
  unban: '<:unban:1509040371324420257>',
  verify: '<:verify:1509040424654864455>',
  warning: '<:warning:1509040360368640151>',
  arrow_left: '<:arrow_left:1516642537828253697>',
};
export const e = (name) => E[name] || '';

// For component icons (button .setEmoji / select-option emoji). Custom emojis
// DON'T render in embed titles or select-menu placeholders, but they DO render
// in descriptions, field values, and on components — so parse "<:name:id>" into
// the { id, name, animated } shape those accept. Returns undefined if unknown.
export const ce = (name) => {
  const m = /^<(a)?:([a-zA-Z0-9_]+):(\d+)>$/.exec(E[name] || '');
  return m ? { id: m[3], name: m[2], animated: !!m[1] } : undefined;
};
