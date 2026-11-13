import { TILES } from './game.js';
const POSITIONS = [[100,290],[100,190],[135,100],[260,85],[390,85],[520,100],[640,175],[640,285],[540,335],[410,340],[280,340],[170,335]];
const tree = (x,y,k=1) => `<g transform="translate(${x} ${y}) scale(${k})"><path d="M0 0v12" stroke="#737d54" stroke-width="4"/><path d="M-12 2L0-25 12 2Z" fill="#8c9a6c"/><path d="M-16 10L0-17 16 10Z" fill="#778c60"/></g>`;
export function renderMap(s) {
  const tutorial = s.level === 'tutorial';
  const positions = tutorial ? POSITIONS.map((p,i) => i===0?[150,270]:i===1?[590,165]:i===11?[550,330]:p) : POSITIONS;
  const visited = new Set(s.log.filter(e => e.action === 'advance' || e.action === 'depart').map(e => e.at));
  const route = tutorial ? 'M150 270V185Q150 95 270 95H480Q590 95 590 165V260Q590 340 500 340H240Q150 340 150 270' : 'M100 290L100 190Q100 85 190 85L450 85Q640 85 640 190L640 260Q640 340 550 340L200 340Q100 340 100 290';
  const nodes = TILES.map((tile,i) => {
    if (tutorial && ![0,1,11].includes(i)) return '';
    const [x,y]=positions[i];
    const active=i===s.position;
    const cleared=(tile.stamp && s.stamps.includes(tile.stamp)) || (tile.boss && s.champion);
    const fill=active?'#234a39':cleared?'#d5dfbc':'#f9f3e2';
    const icon=cleared?'✓':tile.kind==='camp'?'⌂':tile.kind==='enemy'?tile.boss?'♜':'⚔':tile.kind==='medic'?'+':tile.kind==='shop'?'⚒':tile.kind==='purse'?'¤':tile.kind==='bench'?'—':'·';
    const offset=i<=5?-32:40;
    return `<g><circle cx="${x}" cy="${y}" r="${active?26:21}" fill="${fill}" stroke="${active?'#234a39':'#a9ad8c'}" stroke-width="${active?3:1.5}"/><text x="${x}" y="${y+6}" text-anchor="middle" font-size="23" fill="${active?'#fff8e6':'#68714d'}">${icon}</text><text class="map-label" x="${x}" y="${y+offset}" text-anchor="middle">${tile.short}</text></g>`;
  }).join('');
  const [hx,hy]=positions[s.position];
  return `<defs><pattern id="grain" width="18" height="18" patternUnits="userSpaceOnUse"><circle cx="4" cy="6" r=".8" fill="#aab18e" opacity=".25"/><circle cx="13" cy="15" r=".7" fill="#aab18e" opacity=".25"/></pattern></defs><rect width="760" height="420" fill="#e9e8d5"/><rect width="760" height="420" fill="url(#grain)"/><path d="${route}" fill="none" stroke="#c8c6a8" stroke-width="36"/><path d="${route}" fill="none" stroke="#dbd5ba" stroke-width="27"/><path d="${route}" fill="none" stroke="#a7aa88" stroke-width="1" stroke-dasharray="3 9"/>${[[45,80,1],[55,115,.8],[700,75,1.2],[690,325,1],[710,360,.8],[52,355,.8],[210,210,.8],[555,220,1],[580,180,.7]].map(a=>tree(...a)).join('')}<g transform="translate(300 165)"><path d="M0 35V-5l75-12v52Z" fill="#d8c7a1" stroke="#ad9b78"/><path d="M-9-3L35-32 85-18 75-8 35-18 0 3Z" fill="#b76340"/><rect x="30" y="7" width="19" height="28" fill="#81735b"/><path d="M0 35h75" stroke="#9d9577" stroke-width="3"/><text x="38" y="62" text-anchor="middle" class="map-label" style="font-size:13px;letter-spacing:2px">THE GUILD GROUNDS</text><text x="38" y="81" text-anchor="middle" class="map-small">EST. LAST TUESDAY</text></g>${nodes}<g transform="translate(${hx+18} ${hy-24})" aria-hidden="true"><ellipse cx="0" cy="30" rx="15" ry="5" fill="#66744d" opacity=".2"/><path d="M-10 8L-17 27H3L9 8" fill="#b64827"/><path d="M-5 18v12M5 18v12" stroke="#343f2e" stroke-width="5"/><rect x="-8" y="5" width="16" height="15" rx="3" fill="#d7aa54"/><circle cy="-3" r="9" fill="#e4b280"/><path d="M-10-5Q-5-20 8-10L12-3H-10Z" fill="#785635"/><path d="M12 9l7-7m-3-5l6 6" stroke="#66705d" stroke-width="3"/><path d="M2-14l9-11" stroke="#b64827" stroke-width="3"/></g><text x="735" y="401" text-anchor="end" class="map-small">${visited.size ? 'FOLLOW THE ORDERS. MIND THE CONSEQUENCES.' : 'YOUR ORDERS ARE THE ONLY PLAN.'}</text>`;
}
