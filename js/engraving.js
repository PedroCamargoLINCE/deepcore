/* DEEPCORE — the engraved edition.
   Original illustrations sampled into a finer CHARACTER lattice, independent
   of the game's logical cells. Pure, DOM-free, no random stream or clock.
   Shapes are source material, not displayed vector art: the output is ASCII
   and a small ink palette. The classic renderer never needs this module. */
(function () {
  'use strict';
  const root = typeof window !== 'undefined' ? window : globalThis;
  const DC = root.DC = root.DC || {};
  const RAMP = ' .,:;irsXA253hMHGS#9B&@';
  const INKS = ['#c5b797', '#b8c9c6', '#d6a257', '#fff0bf', '#82c8ba', '#dc7858'];
  const clamp = (v, lo, hi) => Math.max(lo, Math.min(hi, v));
  const grain = (x, y) => ((Math.imul(x + 13, 374761393) ^ Math.imul(y + 71, 668265263)) >>> 0) % 97 / 97;

  function plate(w, h) {
    w = clamp(w | 0, 8, 320); h = clamp(h | 0, 8, 160);
    const light = new Float32Array(w * h), ink = new Uint8Array(w * h);
    const glyph = new Uint16Array(w * h);
    function shape(test, value, color) {
      for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
        const u = (x + .5) / w, v = (y + .5) / h;
        if (!test(u, v)) continue;
        const k = y * w + x;
        light[k] = clamp(typeof value === 'function' ? value(u, v) : value, 0, 1);
        ink[k] = typeof color === 'function' ? color(u,v) : (color || 0); glyph[k] = 0;
      }
    }
    function rect(x, y, rw, rh, value, color) {
      shape((u, v) => u >= x && u <= x + rw && v >= y && v <= y + rh, value, color);
    }
    function ellipse(x, y, rx, ry, value, color) {
      shape((u, v) => ((u - x) / rx) ** 2 + ((v - y) / ry) ** 2 <= 1, value, color);
    }
    function poly(points, value, color) {
      shape((u, v) => {
        let inside = false;
        for (let i = 0, j = points.length - 1; i < points.length; j = i++) {
          const a = points[i], b = points[j];
          if ((a[1] > v) !== (b[1] > v) && u < (b[0] - a[0]) * (v - a[1]) / (b[1] - a[1]) + a[0]) inside = !inside;
        }
        return inside;
      }, value, color);
    }
    function line(x1, y1, x2, y2, thick, value, color) {
      const dx = x2 - x1, dy = y2 - y1, len = dx * dx + dy * dy;
      shape((x, y) => {
        const t = len ? clamp(((x - x1) * dx + (y - y1) * dy) / len, 0, 1) : 0;
        return (x - x1 - t * dx) ** 2 + (y - y1 - t * dy) ** 2 < thick * thick;
      }, value, color);
    }
    function label(x, y, text, color) {
      const ix = Math.floor(x * w), iy = Math.floor(y * h);
      for (let i = 0; i < text.length && ix + i < w; i++) {
        if (ix + i < 0 || iy < 0 || iy >= h) continue;
        const k = iy * w + ix + i;
        glyph[k] = text.charCodeAt(i); light[k] = .85; ink[k] = color || 1;
      }
    }
    function finish() {
      const rows = [], tones = new Uint8Array(w * h);
      for (let y = 0; y < h; y++) {
        let row = '';
        for (let x = 0; x < w; x++) {
          const k = y * w + x, l = light[k];
          const value = l > 0 ? clamp(l + (grain(x, y) - .5) * .12, .04, 1) : 0;
          row += glyph[k] ? String.fromCharCode(glyph[k]) : RAMP[Math.round(value * (RAMP.length - 1))];
          tones[k] = ink[k] * 8 + Math.min(7, Math.floor(l * 8));
        }
        rows.push(row);
      }
      return { w, h, rows, tones };
    }
    return { w, h, shape, rect, ellipse, poly, line, label, finish };
  }

  function grit(p, o) {
    const { rect, ellipse, poly, line } = p;
    // Work coat, neck and a face lit from the left. Uneven cheeks and nose,
    // not a scaled-up emoticon. The Company has had forty years of this man.
    poly([[.02,1],[.08,.89],[.3,.78],[.39,.72],[.62,.72],[.7,.8],[.91,.9],[.98,1]],
      (x,y) => .22 + .25 * (1-x) + .06 * Math.sin(x*75+y*5), 4);
    ellipse(.5,.75,.125,.13,(x) => .7-(x-.35)*.9,0);
    poly([[.28,.82],[.39,.77],[.5,.91],[.4,.97]],.7,1);
    poly([[.62,.77],[.73,.83],[.63,.98],[.5,.91]],.43,1);
    line(.5,.92,.5,1,.006,.85,2);
    for (let i=0;i<4;i++) line(.13+i*.055,.88-i*.014,.1+i*.055,1,.006,.6,2);
    ellipse(.264,.48,.047,.097,.42,0); ellipse(.737,.48,.047,.097,.24,0);
    ellipse(.5,.46,.239,.307,(x,y) => .75-(x-.28)*.78+(y-.35)*.12,0);
    poly([[.276,.5],[.303,.66],[.378,.78],[.49,.82],[.624,.775],[.704,.625],[.72,.49]],
      (x,y) => .65-(x-.3)*.7-(y-.6)*.35,0);
    // Temples, jaw stubble and cheek folds are separate tonal planes.
    poly([[.28,.35],[.3,.54],[.33,.52],[.34,.32]],.18,1);
    poly([[.665,.33],[.667,.54],[.713,.51],[.72,.34]],.17,1);
    poly([[.32,.6],[.38,.72],[.5,.79],[.635,.72],[.685,.59],[.65,.75],[.51,.826],[.375,.77]],.27,1);
    line(.327,.526,.37,.562,.006,.24,0); line(.63,.565,.683,.514,.007,.22,0);
    line(.333,.543,.365,.583,.004,.81,0);
    // Broad hard hat with pressed ridges, rolled brim and a real lamp.
    ellipse(.5,.224,.278,.172,(x,y)=>.75-(x-.22)*.8+(y-.1)*.4,2);
    rect(.232,.23,.536,.077,(x)=>.72-(x-.23)*.75,2);
    for (const x of [.31,.39,.61,.69]) line(x,.135,x-.018,.292,.007,.34,2);
    poly([[.47,.055],[.527,.055],[.55,.3],[.446,.3]],.77,2);
    poly([[.184,.292],[.4,.278],[.755,.3],[.818,.334],[.797,.354],[.251,.333],[.183,.316]],.89,2);
    line(.253,.342,.735,.36,.012,.12,0);
    ellipse(.498,.2,.075,.075,.25,1);
    ellipse(.498,.195,.058,.059,.9,1);
    ellipse(.498,.194,.044,.045,.27,4);
    ellipse(.484,.177,.019,.02,.99,3);
    // Safety goggles: dark seals, old glass, reflected inspection light.
    line(.273,.405,.73,.41,.02,.23,1);
    for (const x of [.386,.608]) {
      ellipse(x,.436,.116,.081,.9,1);
      ellipse(x,.44,.1,.066,.11,1);
      ellipse(x-.008,.43,.085,.047,(u,v)=>.2+(1-(v-.39)/.1)*.18,4);
      line(x-.063,.418,x+.04,.411,.006,.85,4);
      line(x-.051,.455,x+.029,.457,.005,.5,3);
    }
    line(.486,.425,.507,.425,.013,.77,1);
    // Nose, nostrils, moustache, lower lip. Speech only changes with a bark.
    poly([[.48,.452],[.466,.529],[.439,.56],[.47,.58],[.529,.581],[.553,.555],[.519,.517],[.51,.457]],
      (x)=>.94-(x-.45)*4,0);
    ellipse(.459,.567,.015,.008,.1,0); ellipse(.533,.567,.015,.008,.09,0);
    poly([[.37,.59],[.461,.572],[.495,.595],[.543,.577],[.628,.6],[.658,.653],
      [.568,.638],[.502,.614],[.435,.64],[.351,.652]],.2,1);
    for (let i=0;i<13;i++) {
      const x=.37+i*.021;
      line(x,.598+Math.abs(x-.5)*.08,x-.012,.639,.003,.45,0);
    }
    ellipse(.503,.666,.079,o.talking ? .022 : .008,.09,0);
    line(.443,.69,.559,.693,.007,.75,0);
    ellipse(.507,.743,.058,.039,.29,1);
    line(.449,.728,.485,.721,.005,.78,0);
    line(.35,.478,.384,.489,.004,.78,0); // the old scar
    if (o.alarm) line(.33,.389,.441,.403,.008,.95,5);
  }

  function rig(p, o) {
    const { rect, ellipse, poly, line } = p, up=o.upgrades||{};
    // Strata are cut in section; hatch direction changes between seams.
    p.shape((x,y)=>y>.72 && Math.abs(x-.5)>.045,
      (x,y)=>.14+.14*(Math.sin(y*93+x*8)>.1)+.06*Math.sin(x*127-y*28),0);
    for(let i=0;i<4;i++) line(.025,.744+i*.065,.975,.76+i*.057,.004,.41,0);
    for(let i=0;i<9;i++) {
      const x=.07+i*.107;
      line(x,.8,x+.029,.89,.003,.065,0);
      line(x+.029,.89,x+.018,.96,.003,.065,0);
    }
    rect(.08,.672,.84,.045,.67,1);
    rect(.09,.715,.82,.013,.32,1);
    // Tracked support carriage; hubs and narrow treads.
    for(const x of [.205,.7]) {
      ellipse(x,.661,.135,.038,.56,1);
      ellipse(x,.661,.108,.025,.18,1);
      for(let i=0;i<5;i++) ellipse(x-.079+i*.039,.661,.013,.016,.72,1);
    }
    // Tapered truss tower, cross braces and left-side ladder.
    poly([[.465,.078],[.534,.078],[.594,.624],[.406,.624]],.095,1);
    line(.468,.076,.4,.633,.009,.84,1); line(.532,.076,.602,.633,.009,.47,1);
    for(let i=0;i<7;i++) {
      const y=.108+i*.071, left=.464-i*.0087, right=.536+i*.0087;
      line(left,y,right,y,.004,.64,2);
      line(left,y,right+.008,y+.067,.004,.58,1);
      line(right,y,left-.008,y+.067,.0025,.31,1);
    }
    line(.437,.169,.387,.604,.003,.8,2);
    for(let i=0;i<15;i++) {
      const y=.17+i*.028;
      line(.437-(y-.169)*.115,y,.458-(y-.169)*.12,y,.0025,.59,2);
    }
    rect(.449,.06,.104,.026,.85,2);
    ellipse(.5,.105,.023,.024,.73,1); ellipse(.5,.105,.012,.013,.12,1);
    line(.502,.125,.502,.56,.003,.8,1);
    // Cab and service shed have perspective side planes and riveted panels.
    poly([[.132,.471],[.302,.471],[.328,.506],[.328,.627],[.13,.627]],
      (x,y)=>.68-(x-.13)*1.4+(y-.47)*.25,2);
    rect(.134,.478,.164,.015,.93,3);
    rect(.146,.505,.138,.052,.1,1);
    for(let i=0;i<3;i++) rect(.153+i*.043,.511,.033,.035,.72,4);
    line(.307,.501,.307,.614,.003,.88,2);
    rect(.181,.584,.064,.019,.19,1);
    for(let i=0;i<5;i++) ellipse(.145+i*.034,.61,.003,.003,.95,3);
    poly([[.664,.465],[.837,.465],[.867,.494],[.867,.627],[.664,.627]],
      (x)=>.6-(x-.66)*1.5,1);
    rect(.664,.465,.173,.014,.82,1);
    for(let i=0;i<7;i++) rect(.685,.499+i*.014,.108,.005,.12,1);
    rect(.816,.507,.024,.079,.61,2);
    rect(.787,.393,.014,.074,.67,1); rect(.78,.387,.03,.012,.42,1);
    // Motor, rotary table, drill string and a faceted cutting head.
    ellipse(.5,.586,.055,.034,.8,2);
    rect(.449,.579,.105,.029,.57,2);
    line(.477,.603,.477,.711,.005,.78,1); line(.524,.603,.524,.711,.005,.4,1);
    rect(.459,.635,.082,.022,.86,2);
    rect(.49,.657,.021,.229,.68,1);
    for(let i=0;i<7;i++) line(.487,.689+i*.028,.514,.7+i*.028,.003,.27,1);
    const bit=up.m_torque ? .055 : .027, phase=(o.phase||0)%3;
    poly([[.5-bit,.87],[.5+bit,.87],[.516,.937],[.5,.96],[.482,.927]],.74,2);
    for(let i=0;i<3;i++) line(.5-bit,.885+i*.017,.5+bit,.877+i*.017+phase*.003,.004,.27,1);
    if(o.active) {
      for(let i=0;i<6;i++) {
        const x=.447+i*.02, y=.94+((i+phase)%3)*.012;
        ellipse(x,y,.003,.003,.97,3);
      }
      for(let i=0;i<5;i++) ellipse(.793+(i%2?-.005:.01),.37-i*.03-(phase*.008),.009+i*.003,.013,.17+i*.013,1);
    }
    // Each of the nine Foundry purchases changes the silhouette or machinery.
    if(up.m_hull) for(const x of [.113,.853]) {
      rect(x,.487,.022,.157,.79,1);
      for(let i=0;i<5;i++) ellipse(x+.011,.505+i*.027,.003,.004,.2,1);
    }
    if(up.m_damp) {ellipse(.5,.365,.062,.054,.72,4);ellipse(.5,.365,.047,.041,.12,1);line(.447,.365,.553,.365,.004,.81,4);}
    if(up.m_scan) {
      // Keep the mast and antenna readable on the small Foundry plate too.
      const mast=Math.max(.012,1.2/p.w), dish=Math.max(.012,1.2/p.h);
      rect(.22-mast/2,.287,mast,.181,.87,1);
      rect(.17,.304-dish/2,.1,dish,.79,4);
      ellipse(.22,.29,.012,.009,.99,4);
    }
    if(up.m_salv) {line(.825,.478,.939,.407,.007,.71,2);line(.939,.407,.95,.573,.004,.72,1);line(.95,.573,.926,.6,.004,.8,2);line(.95,.573,.972,.6,.004,.8,2);}
    if(up.m_stock) {rect(.028,.533,.087,.1,.61,2);rect(.04,.55,.06,.064,.29,2);line(.028,.57,.115,.57,.003,.79,1);}
    if(up.m_deep) {
      rect(.171,.563,.098,.066,.12,1);
      poly([[.22,.559],[.252,.594],[.22,.632],[.188,.594]],.93,4);
    }
    if(up.m_fix) {rect(.687,.595,.047,.034,.9,2);line(.71,.598,.71,.622,.005,.17,1);}
    if(up.m_schem) {rect(.694,.426,.069,.027,.77,3);ellipse(.763,.439,.009,.015,.45,1);}
    if(o.cat) {
      ellipse(.323,.453,.023,.013,.83,0);ellipse(.304,.435,.012,.014,.9,0);
      poly([[.293,.432],[.293,.414],[.303,.425],[.313,.415],[.315,.437]],.92,0);
      line(.343,.452,.359,.436,.004,.82,0);
    }
    if(o.wreck) {
      for(let i=0;i<11;i++) poly([[.12+i*.07,.66],[.17+i*.067,.59+(i%3)*.08],[.26+i*.066,.77]],.33+(i%3)*.12,0);
      line(.47,.19,.65,.45,.013,.9,5);
    }
    if(o.quake)for(let i=0;i<7;i++){
      const x=.27+i*.08,y=.57+(i%3)*.04;
      line(x,y,x+.017,y-.045,.008,.98,3);
    }
  }

  function core(p,o) {
    const {ellipse,line}=p;
    // Aspect compensation: a round core in physical pixels, not square cells.
    const rx=Math.min(.4,.43*p.h*1.9/p.w), ry=rx*p.w/(p.h*1.9);
    ellipse(.5,.5,rx,ry,(x,y)=>{
      const dx=(x-.5)/rx,dy=(y-.5)/ry,z=Math.sqrt(Math.max(0,1-dx*dx-dy*dy));
      const bands=Math.sin(x*93+Math.sin(y*35)*1.8);
      return .15+.62*z+.13*bands;
    },2);
    ellipse(.5,.5,rx*.46,ry*.27,.12,5);
    ellipse(.5,.5,rx*.31,ry*.23,.94,3);
    ellipse(.51,.5,rx*.085,ry*.21,.04,1);
    if(o.cracked) {
      const pts=[[.49,.5-ry],[.455,.33],[.514,.39],[.46,.59],[.53,.68],[.51,.5+ry]];
      for(let i=1;i<pts.length;i++)line(...pts[i-1],...pts[i],.006,.025,1);
    }
  }

  // Schematic source pictograms remain recognisable, but get real edges,
  // cross-hatched metal and a finer lattice rather than enlarged old glyphs.
  function schematic(p,o) {
    const id=o.id||'s_extract', source=DC.Art && DC.Art.detailIcon && DC.Art.detailIcon(id, p.w, p.h, false);
    if(!source) {rig(p,o);return;}
    p.shape((x,y)=>{
      const cx=Math.min(p.w-1,Math.floor(x*p.w)),cy=Math.min(p.h-1,Math.floor(y*p.h));
      const ch=source[cy] && source[cy][cx];
      return ch && ch!==' ';
    },(x,y)=>.4+.43*(1-y)+.1*Math.sin(x*80+y*25),(x)=>x<.4?2:1);
    // The source's material silhouette is retained; no new game symbol.
  }

  const ENCOUNTERS=['vault','crack','drone','pool','ghost','crate','rations','ladder',
    'door','tally','seam','terminal','sump','watchman','coin','crossing','suit','shrine','wind','offer'];
  function encounter(p,o) {
    const {rect,ellipse,poly,line,label}=p,id=o.id;
    // A gallery lit by the object in it. This is the scene, not a picture of
    // the choice's reward: no fortune-telling and no new lore or mechanics.
    p.shape((x,y)=> y>.82 || x<.12+.055*Math.sin(y*18) || x>.9+.04*Math.sin(y*22) || y<.08+.035*Math.sin(x*27),
      (x,y)=>.14+.1*Math.sin(x*87+y*52)**2,0);
    line(.13,.825,.89,.825,.003,.35,1);
    const box=(x,y,w,h,c)=>{
      rect(x,y,w,h,(u,v)=>.73-(u-x)/w*.3-(v-y)/h*.09,c||2);
      line(x,y,x+w,y,.005,.92,1);line(x+w,y,x+w,y+h,.005,.3,1);
    };
    const lamp=(x,y)=>{
      ellipse(x,y-.09,.057,.061,.65,1);ellipse(x,y-.088,.043,.047,0,1);
      box(x-.047,y-.066,.094,.134,1);rect(x-.032,y-.053,.065,.102,.94,3);
      line(x-.022,y-.05,x-.022,y+.047,.004,.5,2);line(x+.023,y-.05,x+.023,y+.047,.004,.5,2);
      rect(x-.059,y+.066,.118,.013,.78,2);
    };
    switch(id) {
      case 'vault':
        box(.27,.15,.46,.66,1);rect(.303,.19,.392,.57,.19,1);
        ellipse(.5,.48,.158,.249,.59,1);ellipse(.5,.48,.14,.229,.28,1);
        ellipse(.5,.48,.072,.112,.78,2);ellipse(.5,.48,.052,.084,.15,1);
        for(let i=0;i<6;i++){const a=i*Math.PI/3;line(.5,.48,.5+Math.cos(a)*.075,.48+Math.sin(a)*.115,.005,.85,1);}
        for(let i=0;i<9;i++)ellipse(.31,.22+i*.057,.008,.012,.85,5);
        break;
      case 'crack': case 'seam': case 'offer': {
        const pts=[[.52,.11],[.45,.27],[.57,.39],[.48,.56],[.56,.69],[.48,.83]];
        for(let i=1;i<pts.length;i++){
          line(...pts[i-1],...pts[i],id==='offer'?.05:.016,.8,id==='seam'?2:4);
          line(...pts[i-1],...pts[i],.006,.15,1);
        }
        if(id==='seam')for(let i=0;i<8;i++)poly([[.43+i*.019,.33+i*.039],[.49+i*.013,.3+i*.039],[.52+i*.016,.34+i*.039]],.67,2);
        if(id==='offer'){ellipse(.476,.465,.022,.013,.95,3);ellipse(.541,.465,.022,.013,.95,3);}
        break;
      }
      case 'drone':
        ellipse(.5,.43,.205,.185,(x,y)=>.85-(x-.3)*1.3,1);
        rect(.35,.414,.3,.095,.24,1);ellipse(.5,.46,.077,.071,.85,2);
        ellipse(.5,.46,.054,.051,.2,5);ellipse(.485,.445,.019,.019,.99,5);
        for(const x of [.22,.69]){box(x,.32,.09,.04,1);line(x+.045,.305,x+.045,.22,.005,.62,1);line(x-.02,.22,x+.115,.22,.004,.76,1);}
        line(.39,.58,.32,.675,.009,.74,1);line(.61,.58,.68,.675,.009,.74,1);
        label(.405,.55,'AUDIT / DMC',1);
        break;
      case 'pool': case 'sump':
        ellipse(.5,.7,.38,.14,.38,1);ellipse(.5,.69,.34,.11,id==='pool'?.53:.17,4);
        for(let i=0;i<5;i++)line(.31+i*.035,.638+i*.023,.68-i*.019,.638+i*.023,.0025,.63,4);
        if(id==='sump'){box(.36,.58,.22,.08,1);ellipse(.39,.63,.029,.03,.57,2);line(.59,.63,.68,.73,.008,.4,1);}
        else for(let i=0;i<4;i++)line(.37+i*.078,.5,.35+i*.078,.36,.003,.22,1);
        break;
      case 'ghost': lamp(.5,.47); break;
      case 'crate': case 'rations':
        box(.24,.45,.52,.345,2);
        for(let i=0;i<5;i++)line(.25,.49+i*.06,.75,.49+i*.06,.004,.22,1);
        line(.29,.46,.29,.79,.016,.78,1);line(.71,.46,.71,.79,.016,.67,1);
        if(id==='crate'){line(.23,.43,.76,.395,.015,.78,2);label(.35,.584,'PERISHABLE',1);rect(.3,.435,.38,.014,.035,1);}
        else {box(.3,.275,.18,.17,1);box(.5,.25,.19,.193,1);label(.34,.32,'DMC',2);label(.55,.3,'DMC',2);}
        break;
      case 'ladder':
        line(.37,.04,.32,.82,.013,.63,1);line(.57,.04,.62,.82,.013,.78,1);
        for(let i=0;i<11;i++){const y=.08+i*.066;line(.37-y*.06,y,.57+y*.06,y,.008,.71,2);}
        break;
      case 'door':
        box(.3,.16,.4,.66,1);box(.332,.188,.338,.616,2);
        rect(.391,.317,.22,.067,.15,1);label(.413,.342,'VOSS',3);
        ellipse(.624,.537,.012,.018,.94,3);line(.623,.544,.577,.544,.007,.87,2);
        for(const y of [.24,.64])rect(.329,y,.025,.08,.82,1);
        break;
      case 'tally':
        for(let gy=0;gy<4;gy++)for(let gx=0;gx<4;gx++){
          const x=.22+gx*.147,y=.22+gy*.127;
          for(let i=0;i<(gx===3&&gy===3?2:4);i++)line(x+i*.024,y,x+i*.024-.012,y+.077,.003,.68,1);
          if(gx!==3||gy!==3)line(x-.025,y+.069,x+.097,y+.017,.003,.73,2);
        }
        break;
      case 'terminal':
        box(.3,.22,.4,.43,1);rect(.328,.245,.344,.32,.1,4);
        for(let i=0;i<6;i++)line(.358,.29+i*.035,.58-(i%3)*.045,.29+i*.035,.002,.83,4);
        label(.36,.506,'EMPLOYEE NO: _',4);
        poly([[.3,.65],[.7,.65],[.76,.735],[.24,.735]],.65,1);
        for(let i=0;i<8;i++)rect(.31+i*.047,.682,.03,.017,.19,1);
        rect(.33,.737,.04,.08,.66,1);rect(.63,.737,.04,.08,.44,1);break;
      case 'watchman': rig(p,{wreck:true,upgrades:{m_scan:1},accent:o.accent});lamp(.224,.4);label(.68,.49,'IX',3);break;
      case 'coin':
        ellipse(.5,.59,.19,.215,.73,2);ellipse(.49,.575,.173,.196,.42,2);
        ellipse(.485,.56,.151,.174,.8,2);ellipse(.488,.562,.129,.148,.48,2);
        label(.456,.548,'DMC',3);line(.438,.634,.537,.634,.006,.87,2);
        for(let i=0;i<17;i++){const a=i*Math.PI*2/17;ellipse(.485+Math.cos(a)*.149,.56+Math.sin(a)*.171,.004,.006,.94,3);}
        break;
      case 'crossing': case 'wind':
        poly([[.22,.83],[.42,.42],[.59,.42],[.82,.83]],.1,1);
        for(let i=0;i<5;i++){
          const a=.09+i*.035;
          line(.5-a,.32+i*.066,.5-a,.82,.007,.39+i*.08,1);
          line(.5+a,.32+i*.066,.5+a,.82,.007,.49+i*.06,1);
          line(.5-a,.32+i*.066,.5+a,.32+i*.066,.008,.58,2);
        }
        if(id==='wind')for(let i=0;i<5;i++)line(.36,.6+i*.028,.61,.65+i*.028,.003,.7,4);
        else {line(.36,.7,.16,.73,.008,.84,2);line(.36,.7,.28,.647,.005,.86,2);}
        break;
      case 'suit':
        ellipse(.32,.48,.053,.063,.59,0);
        poly([[.35,.49],[.54,.55],[.63,.66],[.56,.727],[.41,.642],[.34,.577]],.44,1);
        line(.57,.69,.77,.76,.024,.51,1);line(.57,.66,.8,.68,.019,.3,1);
        poly([[.365,.507],[.436,.562],[.426,.587]],.95,3);
        line(.39,.547,.48,.617,.006,.64,5);
        box(.66,.48,.137,.117,2);line(.694,.475,.75,.475,.01,.79,1);break;
      case 'shrine':
        for(let i=0;i<5;i++)box(.32-i*.014,.59+i*.04,.36+i*.028,.035,1);
        ellipse(.5,.47,.092,.107,.81,2);ellipse(.5,.47,.037,.044,0,1);
        for(let i=0;i<8;i++){const a=i*Math.PI/4;line(.5+Math.cos(a)*.08,.47+Math.sin(a)*.1,.5+Math.cos(a)*.105,.47+Math.sin(a)*.127,.011,.77,2);}
        for(const x of [.24,.73]){rect(x,.54,.025,.13,.83,3);ellipse(x+.012,.52,.012,.027,.97,5);}break;
    }
  }

  function descent(p,o) {
    const {rect,line,poly,ellipse}=p,phase=(o.phase||0)%3;
    p.shape((x,y)=>y>.48 && Math.abs(x-.5)>.13+(y-.48)*.12,
      (x,y)=>.22+.12*Math.sin(y*76+x*9+phase)+.04*Math.sin(x*157),0);
    rect(.464,0,.072,.5,(x)=>.92-(x-.464)*7,1);
    for(let i=0;i<8;i++)line(.46,i*.065,.54,i*.065+.023,.004,.25,1);
    poly([[.285,.44],[.715,.44],[.667,.68],[.5,.9],[.333,.68]],
      (x,y)=>.88-(x-.285)*1.2+(y-.44)*.18,2);
    poly([[.5,.44],[.59,.44],[.565,.71],[.5,.9]],.92,1);
    for(let i=0;i<5;i++) {
      const y=.473+i*.062,left=.29+i*.023,right=.71-i*.023;
      line(left,y+.046,right,y-.012+phase*.006,.01,.16,1);
      line(left,y+.036,right,y-.022+phase*.006,.004,.94,3);
    }
    rect(.29,.405,.42,.027,.84,1);
    for(let i=0;i<14;i++) {
      const x=.23+(i/13)*.54,y=.66+((i*7+phase*3)%11)*.025;
      if(Math.abs(x-.5)>.11)ellipse(x,y,.004+(i%3)*.002,.006,.61+(i%2)*.3,i%3?0:3);
    }
  }

  // Objects on the Company's desks. These are illustrated from their own
  // geometry, never enlarged five-character trophy glyphs.
  function object(p,o) {
    const {rect,ellipse,poly,line,label}=p, id=o.id||'first_win';
    const metal=(x)=>.85-x*.42;
    const book=()=>{
      poly([[.17,.2],[.48,.25],[.5,.83],[.15,.76]],.6,2);
      poly([[.5,.25],[.83,.17],[.85,.76],[.5,.83]],.78,0);
      line(.49,.25,.5,.82,.012,.2,1);
      for(let i=0;i<6;i++){line(.22,.32+i*.065,.44,.36+i*.062,.008,.28,1);line(.56,.35+i*.065,.78,.3+i*.065,.008,.4,1);}
    };
    const paper=()=>{
      rect(.24,.14,.52,.66,.65,0);rect(.27,.16,.46,.6,.3,1);
      for(let i=0;i<5;i++)rect(.32,.23+i*.08,.34-(i%2)*.08,.017,.68,0);
    };
    if(o.locked){rect(.16,.84,.68,.05,.19,1);for(let i=0;i<8;i++)ellipse(.22+i*.08,.82,.009,.018,.28,0);return;}
    switch(id) {
      case 'first_win': case 'shareholder':
        for(const x of id==='shareholder'?[.27,.5,.73]:[.5]) {
          poly([[x,.13],[x+.15,.4],[x,.76],[x-.15,.4]],metal,2);
          poly([[x,.13],[x,.76],[x-.15,.4]],.95,3);
        }break;
      case 'sub15':
        rect(.45,.1,.1,.1,.7,1);ellipse(.5,.49,.29,.33,metal,1);ellipse(.5,.49,.24,.27,.15,1);
        line(.5,.49,.5,.27,.012,.94,3);line(.5,.49,.66,.59,.014,.8,2);
        for(let i=0;i<12;i++){const a=i*Math.PI/6;ellipse(.5+Math.sin(a)*.21,.49+Math.cos(a)*.24,.012,.018,.7,1);}break;
      case 'no_repair':
        poly([[.27,.72],[.61,.31],[.72,.4],[.38,.82]],metal,1);
        poly([[.6,.17],[.75,.14],[.66,.28],[.75,.36],[.86,.23],[.84,.41],[.66,.48],[.55,.32]],.83,1);break;
      case 'scenic':
        rect(.14,.19,.72,.6,.72,2);rect(.19,.24,.62,.5,.14,4);
        ellipse(.67,.37,.067,.082,.94,3);poly([[.2,.68],[.37,.39],[.54,.64],[.67,.49],[.81,.73]],.59,4);break;
      case 'depth12':
        poly([[.26,.7],[.39,.4],[.52,.62],[.68,.28],[.77,.73]],metal,1);
        line(.52,.13,.52,.51,.022,.89,5);line(.42,.25,.62,.25,.015,.72,5);break;
      case 'cat':
        ellipse(.52,.61,.23,.2,.63,0);ellipse(.43,.38,.16,.18,.81,0);
        poly([[.27,.36],[.27,.13],[.4,.24],[.51,.15],[.59,.38]],.79,0);
        ellipse(.37,.35,.018,.028,.95,4);ellipse(.48,.35,.018,.028,.95,4);
        line(.69,.63,.82,.45,.045,.68,0);break;
      case 'schems_all': case 'logbook_full':book();if(id==='schems_all')line(.29,.64,.7,.41,.012,.86,4);break;
      case 'wormfood':
        for(let i=0;i<9;i++)ellipse(.2+i*.071,.45+Math.sin(i*.7)*.16,.064,.073,.5+i*.04,5);
        ellipse(.77,.41,.016,.023,.99,3);poly([[.34,.8],[.43,.6],[.54,.81]],.7,4);break;
      case 'hard_hats':
        ellipse(.5,.46,.32,.28,metal,2);rect(.18,.46,.64,.17,.66,2);
        rect(.12,.63,.76,.07,.91,2);rect(.46,.2,.08,.4,.9,1);ellipse(.5,.4,.1,.1,.2,1);ellipse(.5,.4,.06,.06,.96,3);break;
      case 'high_score':
        rect(.47,.32,.06,.45,.68,4);
        for(const v of [[.33,.29],[.67,.29],[.5,.19]])ellipse(v[0],v[1],.17,.16,.79,4);
        poly([[.26,.66],[.75,.66],[.67,.82],[.34,.82]],.7,2);break;
      case 'company_man':case 'daily_win':case 'hazard_win':case 'warrant_win':
        paper();
        if(id==='company_man')label(.38,.43,'10',3);
        if(id==='daily_win'){rect(.2,.12,.6,.075,.9,2);label(.44,.5,'T',3);}
        if(id==='hazard_win')poly([[.63,.45],[.81,.72],[.46,.72]],.96,5);
        if(id==='warrant_win'){line(.31,.35,.69,.71,.027,.85,5);line(.69,.35,.31,.71,.027,.85,5);}break;
      default:book();
    }
    rect(.12,.86,.76,.055,.65,1);rect(.22,.81,.56,.04,.36,2);
    if(o.selected)line(.17,.94,.83,.94,.012,.86,2);
  }

  function seal(p,o) {
    const {rect,ellipse,line,poly}=p;
    const locked=!!o.locked, ink=locked?1:o.id==='warrant'?5:2;
    // Medal in physically round proportions on the broad contract plates.
    const rx=Math.min(.23,.35*p.h*1.9/p.w), ry=rx*p.w/(p.h*1.9);
    poly([[.5-rx*.7,.52],[.5-rx*1.2,.94],[.5,.81],[.5+rx*1.2,.94],[.5+rx*.7,.52]],locked?.21:.54,ink);
    ellipse(.5,.43,rx,ry,.62,ink);ellipse(.5,.43,rx*.81,ry*.81,.19,1);
    if(locked){rect(.5-rx*.33,.39,rx*.66,ry*.61,.56,1);ellipse(.5,.35,rx*.3,ry*.34,.62,1);}
    else if(o.id==='warrant'){line(.5-rx*.43,.43-ry*.43,.5+rx*.43,.43+ry*.43,.016,.9,5);line(.5+rx*.43,.43-ry*.43,.5-rx*.43,.43+ry*.43,.016,.9,5);}
    else if(o.id==='hazard'){poly([[.5,.43-ry*.62],[.5+rx*.6,.43+ry*.48],[.5-rx*.6,.43+ry*.48]],.92,2);rect(.49,.36,.02,.12,.12,1);}
    else{line(.5-rx*.45,.43,.49,.43+ry*.35,.018,.85,4);line(.49,.43+ry*.35,.5+rx*.5,.43-ry*.4,.018,.85,4);}
    for(let i=0;i<4;i++){line(.08,.24+i*.15,.5-rx*1.5,.24+i*.15,.005,.21,1);line(.5+rx*1.5,.24+i*.15,.92,.24+i*.15,.005,.21,1);}
    if(o.won)line(.34,.98,.66,.98,.012,.86,4);
  }

  function station(p,o) {
    const {rect,ellipse,line,poly,label}=p, id=o.id||'archive';
    if(id==='archive') {
      rect(.18,.03,.64,.94,.24,2);rect(.26,.07,.48,.86,.12,1);
      for(let i=0;i<20;i++){
        const y=.09+i*.041,found=(o.found||[]).indexOf(i)>=0;
        rect(.3,y,.38,.022,found?.72:.24,found?2:1);
        rect(.2,y,.075,.022,found?.9:.24,1);
      }
      line(.14,.02,.14,.97,.015,.75,1);return;
    }
    if(id==='bore') {
      for(let i=0;i<8;i++){
        const y=.05+i*.11;
        rect(.13,y,.74,.09,.19+i*.033,i%3?0:2);
        line(.16,y+.056,.84,y+.022,.007,.55,1);
        if(i<Math.min(8,o.depth||1))rect(.45,y,.1,.1,.89,2);
      }
      if((o.depth||1)>8)poly([[.38,.92],[.62,.92],[.5,.99]],.94,5);
      return;
    }
    if(id==='forge'){
      poly([[.18,.22],[.89,.22],[.78,.39],[.62,.4],[.58,.71],[.83,.78],[.83,.88],[.19,.88],[.19,.78],[.4,.7],[.36,.4],[.15,.36],[.05,.25]],(x,y)=>.87-y*.5,1);
      rect(.17,.19,.7,.035,.99,2);
      for(let i=0;i<4;i++)line(.48+i*.07,.42,.48+i*.064,.64,.01,.24,1);
      if(o.struck)for(let i=0;i<7;i++)line(.53,.14,.2+i*.1,.03+(i%2)*.06,.011,.99,3);
      return;
    }
    if(id==='pause'){
      ellipse(.5,.49,.35,.4,.63,1);ellipse(.5,.49,.28,.32,.15,1);
      rect(.34,.26,.11,.46,.85,2);rect(.55,.26,.11,.46,.85,2);return;
    }
    if(id==='accounts'){
      rect(.16,.08,.68,.83,.6,2);rect(.22,.12,.56,.75,.12,1);
      for(let i=0;i<6;i++){
        const y=.2+i*.112;line(.22,y,.78,y,.008,.66,1);
        for(let j=0;j<3;j++)ellipse(.31+j*.11+(i%2)*.13,y,.043,.045,.82,2);
      }return;
    }
    // Bound technical manual: folded pages and a brass spine.
    object(p,{id:'logbook_full'});
    label(.35,.44,id==='manual2'?'II':id==='manual3'?'III':'I',3);
  }

  function machine(p,o) {
    const {rect,line,ellipse,poly}=p, id=o.id||'extractor';
    const active=!!o.active, phase=active?(o.phase||0)%3:0;
    rect(.08,.82,.84,.065,.72,1);rect(.16,.885,.17,.07,.35,1);rect(.67,.885,.17,.07,.35,1);
    poly([[.19,.34],[.68,.34],[.84,.43],[.84,.8],[.19,.8]],(x)=>.77-x*.5,1);
    rect(.21,.38,.43,.37,.12,1);
    if(id==='smelter'){
      ellipse(.45,.54,.18,.23,.69,2);ellipse(.45,.54,.13,.18,active?.94:.23,active?5:1);
      for(let i=0;i<4;i++)line(.31+i*.09,.36,.31+i*.09,.74,.008,.6,1);
      rect(.65,.13,.06,.22,.58,1);rect(.63,.11,.1,.025,.84,1);
      if(active)for(let i=0;i<3;i++)ellipse(.68+(i%2)*.018,.08-i*.028-phase*.012,.021+i*.01,.016,.25,0);
    }else if(id==='damper'){
      ellipse(.45,.51,.25,.3,.78,4);ellipse(.45,.51,.2,.25,.12,1);
      ellipse(.45,.51,.12,.19,.66,2);ellipse(.45,.51,.07,.13,.12,1);
      line(.2,.5+phase*.018,.7,.5-phase*.018,.022,.88,1);rect(.41,.15,.07,.63,.6,1);
    }else if(id==='crusher'){
      poly([[.2,.12],[.75,.12],[.62,.4],[.33,.4]],.77,2);
      for(const x of [.33,.57]){
        ellipse(x,.58,.12,.17,.73,1);
        for(let i=0;i<3;i++)line(x-.07,.49+i*.065+phase*.012,x+.07,.52+i*.065,.012,.21,1);
      }
    }else if(id==='loader'){
      line(.28,.75,.41,.19,.033,.88,2);line(.41,.19,.71,.33,.028,.77,1);
      ellipse(.41,.19,.054,.061,.88,1);line(.71,.33,.66,.52,.018,.8,2);line(.71,.33,.81,.47,.018,.8,2);
    }else if(id==='extractor'){
      rect(.4,.11,.08,.59,.85,2);
      for(let i=0;i<5;i++)line(.38,.32+i*.067,.51,.35+i*.067+(phase*.012),.016,.23,1);
      poly([[.36,.71],[.53,.71],[.45,.84]],.92,2);
      line(.25,.2,.7,.2,.025,.8,1);
    }else if(id==='assembler'){
      for(let i=0;i<8;i++){
        const a=i*Math.PI/4+phase*.18;
        line(.44+Math.cos(a)*.09,.56+Math.sin(a)*.12,.44+Math.cos(a)*.18,.56+Math.sin(a)*.22,.022,.78,2);
      }ellipse(.44,.56,.075,.1,.76,1);ellipse(.44,.56,.035,.045,.13,1);
      rect(.23,.23,.11,.11,.72,2);line(.285,.29,.54,.38,.02,.83,1);
    }else{
      // Logistics bodies share the conveyor grammar, not the production rotor.
      for(let i=0;i<4;i++)ellipse(.29+i*.092,.61,.035,.15,.57,1);
      line(.22,.45,.64,.45,.012,.9,2);line(.22,.76,.64,.76,.012,.72,2);
      if(id==='buffer')for(let i=0;i<3;i++)rect(.26+i*.115,.43,.08,.21,.69,2);
      if(id==='filter'){rect(.41,.39,.034,.42,.86,4);ellipse(.45,.21,.06,.07,.84,4);}
      if(id==='splitter'){line(.44,.48,.72,.22,.02,.82,2);line(.44,.48,.27,.21,.02,.82,2);}
      if(id==='tunnel'){ellipse(.44,.49,.24,.28,.7,2);ellipse(.44,.52,.17,.2,.1,1);}
    }
    for(let i=0;i<4;i++)rect(.7,.49+i*.065,.095,.017,.19,1);
    ellipse(.75,.43,.022,.027,active?.95:.28,active?4:1);
    if(o.bad)line(.69,.73,.8,.62,.021,.96,5);
  }

  function create(kind,w,h,options) {
    const p=plate(w,h),o=options||{};
    if(kind==='grit')grit(p,o);
    else if(kind==='core')core(p,o);
    else if(kind==='schematic')schematic(p,o);
    else if(kind==='encounter')encounter(p,o);
    else if(kind==='descent')descent(p,o);
    else if(kind==='trophy')object(p,o);
    else if(kind==='seal')seal(p,o);
    else if(kind==='station')station(p,o);
    else if(kind==='machine')machine(p,o);
    else rig(p,o);
    return p.finish();
  }
  function palette(accent,ground) {
    const colors=INKS.slice(); if(/^#[0-9a-f]{6}$/i.test(accent||''))colors[2]=accent;
    if(/^#[0-9a-f]{6}$/i.test(ground||''))colors[0]=ground;
    const result=[];
    for(const hex of colors)for(let i=0;i<8;i++) {
      const f=.4+i*.105;
      result.push('#'+[1,3,5].map(k=>clamp(Math.round(parseInt(hex.slice(k,k+2),16)*f),0,255).toString(16).padStart(2,'0')).join(''));
    }
    return result;
  }
  function tile(kind,edge,variant) {
    // Upper-left illumination, rough sediment versus glass cleavage. The
    // three micro-rows still occupy exactly one clickable map cell.
    if(kind==='machine')return ['o=o','|:|','+-+'];
    if(kind==='obsidian')return [edge&1?'__/':'. /',edge&2?'| /':':/ ',edge&4?'/_/':'/ .'];
    const patterns=[[':;.',',x:',".;'"],['.,:',":;.",',:.'],[';:.',".';",':,x']];
    const rows=patterns[variant%patterns.length].slice();
    if(edge&1)rows[0]='___';
    if(edge&2)rows[1]='|'+rows[1].slice(1);
    if(edge&4)rows[2]='---';
    if(edge&8)rows[1]=rows[1].slice(0,2)+'|';
    return rows;
  }
  DC.Engraving={create,palette,tile,RAMP,ENCOUNTERS};
})();
