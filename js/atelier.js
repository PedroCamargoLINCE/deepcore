/* DEEPCORE / Bedrock — a vector atelier, not a character rasterizer.
   Pure geometry. Canvas and SVG share the same authored objects. No DOM,
   clocks, game objects, random stream, fonts, or external assets live here. */
(function () {
  'use strict';
  const root = typeof window !== 'undefined' ? window : globalThis;
  const DC = root.DC = root.DC || {};
  const P = {
    ink: '#101d35',
    deep: '#0a1023',
    steel: '#70c7e0',
    light: '#bceeff',
    gold: '#ffbd46',
    goldHi: '#fff29c',
    rust: '#f47b45',
    red: '#ff596b',
    blue: '#4aa9ff',
    green: '#54dfb0',
    cream: '#fff0c4',
    coal: '#26334c',
    violet: '#c481ff',
    rose: '#ff9cbb',
    white: '#f0fbff'
  };
  function mix(a, b, t) {
    const n = s => [1,3,5].map(i => parseInt(s.slice(i, i + 2), 16));
    const x = n(a), y = n(b);
    return '#' + x.map((v, i) => Math.round(v + (y[i] - v) * t).toString(16).padStart(2, '0')).join('');
  }
  function canvasPen(c, x, y, w, h) {
    const X = v => x + v * w / 100, Y = v => y + v * h / 100;
    return {
      rect(a, b, d, e, color) {
        c.fillStyle = color;
        c.fillRect(X(a), Y(b), d * w / 100, e * h / 100);
      },
      poly(points, color, stroke, width) {
        c.beginPath();
        points.forEach((p, i) => i ? c.lineTo(X(p[0]), Y(p[1])) : c.moveTo(X(p[0]), Y(p[1])));
        c.closePath();
        if (color) {
          c.fillStyle = color;
          c.fill();
        }
        if (stroke) {
          c.strokeStyle = stroke;
          c.lineWidth = (width || 1) * Math.min(w, h) / 100;
          c.stroke();
        }
      },
      line(points, color, width) {
        c.beginPath();
        points.forEach((p, i) => i ? c.lineTo(X(p[0]), Y(p[1])) : c.moveTo(X(p[0]), Y(p[1])));
        c.strokeStyle = color;
        c.lineWidth = (width || 1) * Math.min(w, h) / 100;
        c.lineCap = 'round';
        c.lineJoin = 'round';
        c.stroke();
      },
      oval(a, b, rx, ry, color, stroke, width) {
        c.beginPath();
        c.ellipse(X(a), Y(b), rx * w / 100, ry * h / 100, 0, 0, Math.PI * 2);
        if (color) {
          c.fillStyle = color;
          c.fill();
        }
        if (stroke) {
          c.strokeStyle = stroke;
          c.lineWidth = (width || 1) * Math.min(w, h) / 100;
          c.stroke();
        }
      }
    };
  }
  function svgPen(out) {
    const pts = p => p.map(q => q.join(',')).join(' ');
    const paint = (color, stroke, width) => ' fill="' + (color || 'none') + '"' + (stroke ? ' stroke="' + stroke + '" stroke-width="' + (width || 1) + '"' : '');
    return {
      rect(x, y, w, h, c) {
        out.push('<rect x="' + x + '" y="' + y + '" width="' + w + '" height="' + h + '" fill="' + c + '"/>');
      },
      poly(p, c, s, w) {
        out.push('<polygon points="' + pts(p) + '"' + paint(c, s, w) + '/>');
      },
      line(p, c, w) {
        out.push('<polyline points="' + pts(p) + '" fill="none" stroke="' + c + '" stroke-width="' + (w || 1) + '" stroke-linecap="round" stroke-linejoin="round"/>');
      },
      oval(x, y, rx, ry, c, s, w) {
        out.push('<ellipse cx="' + x + '" cy="' + y + '" rx="' + rx + '" ry="' + ry + '"' + paint(c, s, w) + '/>');
      }
    };
  }
  function gear(p, cx, cy, r, color, phase) {
    const pts = [];
    for (let i = 0; i < 48; i++) {
      const a = i * Math.PI / 24 + (phase || 0), rr = r * ([0,3].includes(i % 4) ? 0.77 : 1);
      pts.push([cx+Math.cos(a)*rr,cy+Math.sin(a)*rr]);
    }
    p.poly(pts, color, P.ink, 2);
    p.oval(cx, cy, r * 0.51, r * 0.51, mix(color, P.white, 0.25));
    p.oval(cx, cy, r * 0.24, r * 0.24, P.ink);
  }
  function arrow(p, dir, color, x, y, size) {
    const a = (dir - 1) * Math.PI / 2, pts = [[-0.45,-0.3],[0.05,-0.3],[0.05,-0.65],[0.7,0],[0.05,0.65],[0.05,0.3],[-0.45,0.3]];
    p.poly(pts.map(q => [x+(q[0]*Math.cos(a)-q[1]*Math.sin(a))*size,y+(q[0]*Math.sin(a)+q[1]*Math.cos(a))*size]), color);
  }
  const SUBJECTS = {
    s_beltfree: 'belt',
    s_extract: 'extractor',
    s_smelt: 'smelter',
    s_coal: 'coal',
    s_plate: 'shield',
    s_damp: 'damper',
    s_repair: 'repair',
    s_drill: 'bit',
    s_salvage: 'claw',
    s_survey: 'radar',
    s_charge: 'charge',
    s_over: 'power',
    s_veins: 'ironOre',
    s_gear: 'gear',
    s_conduit: 'tunnel',
    s_yoke: 'splitter',
    s_gate: 'filter',
    s_grind: 'crusher',
    s_boiler: 'magma',
    s_echo: 'charge',
    s_chute: 'claw',
    s_jury: 'repair',
    s_insure: 'shield',
    s_loop: 'damper',
    s_whisper: 'worm',
    m_stock: 'crate',
    m_hull: 'shield',
    m_damp: 'damper',
    m_torque: 'bit',
    m_fix: 'repair',
    m_scan: 'radar',
    m_salv: 'claw',
    m_deep: 'charge',
    m_schem: 'book',
    standard: 'seal',
    hazard: 'shield',
    warrant: 'skull',
    anvil: 'anvil',
    drowned: 'extractor',
    warmspot: 'warm',
    glassforest: 'crystal',
    seal: 'seal',
    bell: 'bell',
    mirror: 'pool',
    root: 'root'
  };
  function draw(id, p, o) {
    o = o || {};
    id = SUBJECTS[id] || id;
    const active = !!o.active, phase = active ? o.phase || 0 : 0;
    const gold = o.accent || P.gold, metal = P.steel;
    // Every resource has a distinct silhouette, not just a material tint.
    switch (id) {
    case 'ironOre':
      p.poly([[10,59],[27,24],[70,17],[91,46],[75,79],[29,86]], P.ink);
      p.poly([[15,56],[29,27],[67,23],[83,46],[64,65],[28,72]], metal);
      p.poly([[28,72],[64,65],[83,46],[76,75],[31,81]], '#3985ad');
      p.line([[27,51],[65,35],[75,44]], P.light, 5);
      p.line([[22,63],[58,50]], P.light, 4);
      break;
    case 'coal':
      p.poly([[8,60],[19,33],[40,29],[54,50],[42,75],[19,79]], P.coal, '#849188', 3);
      p.poly([[46,37],[60,13],[81,22],[91,45],[70,61],[51,56]], '#202f32', '#849188', 3);
      p.poly([[40,68],[58,49],[82,57],[89,80],[64,91],[43,85]], '#1c282b', '#849188', 3);
      p.line([[19,42],[32,51],[26,65]], '#566967', 2);
      p.line([[60,24],[70,34],[64,45]], '#566967', 2);
      p.line([[58,59],[64,70],[56,79]], '#566967', 2);
      break;
    case 'copperOre':
      p.poly([[10,49],[32,20],[51,31],[56,60],[31,80],[12,68]], '#e96b3c', P.ink, 3);
      p.poly([[54,29],[78,21],[92,51],[78,75],[55,65]], '#ffab58', P.ink, 3);
      p.poly([[13,49],[32,25],[43,37],[30,53]], '#ffe2a0');
      p.line([[59,40],[78,33],[84,48]], '#f6c796', 4);
      break;
    case 'crystal':
      p.poly([[19,61],[22,33],[35,23],[45,60],[38,81]], '#815be2', P.ink, 3);
      p.poly([[37,72],[40,22],[57,7],[73,26],[68,70],[52,94]], P.violet, P.ink, 2);
      p.poly([[40,22],[57,7],[55,70],[52,94],[37,72]], '#ecc0ff');
      p.poly([[64,70],[70,45],[84,34],[95,60],[85,85]], '#a064ef', P.ink, 3);
      p.line([[57,18],[62,28],[59,58]], '#f1e7fc', 3);
      break;
    case 'ironPlate':
    case 'copperPlate': {
        const c = id === 'ironPlate' ? metal : '#ff9861';
        p.poly([[10,62],[67,39],[92,54],[35,79]], mix(c, P.ink, 0.2), P.ink, 2);
        p.poly([[10,48],[67,25],[92,40],[35,65]], c, P.ink, 2);
        p.poly([[35,65],[92,40],[92,49],[35,74]], mix(c, P.ink, 0.32));
        p.line([[19,47],[65,30],[80,39]], mix(c, P.white, 0.55), 3);
        break;
      }
    case 'gear':
      gear(p, 50, 50, 40, gold, phase * 0.35);
      break;
    case 'charge':
      p.rect(31, 13, 38, 73, P.ink);
      p.rect(36, 18, 28, 61, P.violet);
      p.rect(31, 18, 38, 12, P.steel);
      p.rect(31, 70, 38, 12, P.steel);
      p.poly([[51,32],[40,52],[50,52],[46,66],[60,44],[50,44]], P.white);
      p.rect(43, 5, 14, 9, P.rust);
      break;
    case 'belt':
      p.rect(8, 21, 84, 60, P.ink);
      p.rect(10, 27, 80, 45, '#607971');
      for (let i = 0; i < 5; i++)
        p.rect(12 + i * 16 + phase * 2, 29, 4, 41, '#99afa0');
      p.rect(8, 17, 84, 8, P.light);
      p.rect(8, 70, 84, 8, P.steel);
      arrow(p, o.facing == null ? 1 : o.facing, gold, 50, 50, 23);
      break;
    case 'extractor':
      p.oval(50, 83, 40, 10, P.ink);
      p.rect(14, 23, 15, 58, P.ink);
      p.rect(70, 23, 15, 58, P.ink);
      p.rect(16, 20, 68, 16, gold);
      p.rect(33, 35, 35, 31, P.steel);
      p.rect(39, 40, 23, 18, P.ink);
      p.rect(43, 49 + phase * 3, 14, 31, P.light);
      p.poly([[37,70+phase*3],[64,70+phase*3],[50,92]], P.steel);
      p.line([[42,75],[58,79]], P.ink, 3);
      p.oval(25, 28, 3, 3, P.ink);
      p.oval(75, 28, 3, 3, P.ink);
      p.rect(8, 76, 22, 8, P.rust);
      p.rect(70, 76, 22, 8, P.rust);
      break;
    case 'smelter':
      p.oval(51, 88, 42, 8, P.ink);
      p.rect(60, 8, 16, 38, P.ink);
      p.rect(64, 10, 9, 25, P.steel);
      p.poly([[12,45],[25,22],[60,22],[84,42],[84,85],[14,85]], P.rust, P.ink, 3);
      p.poly([[25,22],[60,22],[84,42],[47,42]], '#d19360');
      p.rect(22, 51, 48, 27, P.ink);
      p.rect(27, 56, 37, 16, active ? '#f0a24c' : '#425853');
      if (active) {
        p.poly([[29,72],[36,56-phase*3],[43,65],[50,49+phase*3],[60,72]], '#ffe6a0');
        p.oval(67, 6 - phase * 2, 7, 4, '#a5a591');
      }
      p.rect(12, 79, 73, 7, '#667c73');
      p.rect(22, 44, 47, 5, '#e3a577');
      break;
    case 'assembler':
      p.oval(50, 88, 42, 7, P.ink);
      p.rect(12, 21, 76, 63, P.ink);
      p.rect(16, 17, 68, 58, P.blue);
      p.rect(22, 25, 56, 39, '#344e50');
      gear(p, 40, 43, 17, P.light, phase * 0.5);
      gear(p, 60, 50, 15, gold, -phase * 0.5);
      p.rect(19, 70, 62, 8, P.steel);
      p.oval(70, 73, 3, 3, active ? '#dbe2aa' : '#405b56');
      p.rect(19, 80, 13, 9, P.ink);
      p.rect(70, 80, 13, 9, P.ink);
      break;
    case 'damper':
      p.oval(50, 85, 30, 9, P.ink);
      p.rect(24, 18, 52, 10, P.light);
      p.rect(30, 27, 40, 47, P.green);
      p.line([[32,33],[67,40],[32,47],[67,54],[32,61],[67,68]], active ? '#c5d8a2' : '#84988a', 4);
      p.rect(20, 76, 60, 10, P.steel);
      p.rect(44, 8, 12, 12, P.ink);
      p.oval(50, 8, 17, 5, active ? '#bfd5a0' : P.steel);
      break;
    case 'splitter':
      p.rect(12, 25, 76, 50, P.ink);
      p.rect(17, 31, 65, 37, P.steel);
      p.line([[15,50],[49,50],[66,28]], P.ink, 10);
      p.line([[49,50],[66,73]], P.ink, 10);
      arrow(p, 0, gold, 67, 26, 17);
      arrow(p, 2, gold, 67, 70, 17);
      p.oval(46, 50, 6, 6, P.rust);
      break;
    case 'tunnel':
      p.rect(12, 43, 76, 40, P.ink);
      p.poly([[12,43],[30,18],[70,18],[88,43]], P.blue, P.ink, 3);
      p.rect(24, 43, 52, 36, '#101f23');
      p.rect(24, 70, 52, 9, P.steel);
      p.line([[24,76],[76,76]], gold, 3);
      arrow(p, o.mode === 'out' ? 0 : 2, gold, 50, 50, 19);
      p.line([[28,33],[70,33]], P.light, 3);
      break;
    case 'loader':
      p.rect(14, 64, 72, 19, P.ink);
      p.rect(21, 58, 58, 16, P.steel);
      p.oval(50, 54, 18, 18, P.blue, P.ink, 3);
      p.line([[50,54],[34+phase*4,28],[70,18]], gold, 10);
      p.oval(50, 54, 6, 6, P.ink);
      p.line([[60,13],[75,16],[70,30]], P.steel, 7);
      break;
    case 'crusher':
      p.oval(50, 88, 42, 8, P.ink);
      p.poly([[12,23],[88,23],[70,70],[30,70]], P.steel, P.ink, 3);
      p.poly([[22,29],[78,29],[65,60],[35,60]], P.ink);
      gear(p, 40, 48, 16, P.rust, phase * 0.5);
      gear(p, 60, 48, 16, P.light, -phase * 0.5);
      p.rect(19, 70, 62, 13, P.blue);
      p.rect(30, 83, 40, 7, P.ink);
      break;
    case 'filter':
      p.rect(9, 25, 82, 52, P.ink);
      p.rect(14, 31, 72, 39, P.steel);
      p.rect(33, 26, 9, 49, P.blue);
      p.rect(53, 26, 9, 49, P.blue);
      p.oval(73, 19, 10, 10, o.filterColor || P.violet, P.ink, 3);
      arrow(p, 1, P.gold, 20, 50, 12);
      break;
    case 'hub':
    case 'rig':
      p.oval(50, 91, 47, 7, P.ink);
      p.rect(8, 72, 84, 17, P.ink);
      p.rect(13, 74, 74, 9, P.steel);
      for (let i = 0; i < 8; i++)
        p.rect(15 + i * 9, 73, 3, 13, '#55716c');
      p.rect(13, 50, 30, 22, gold);
      p.rect(17, 50 + 4, 17, 12, P.blue);
      p.rect(70, 43, 19, 29, P.rust);
      p.poly([[40,71],[44,9],[60,9],[67,71]], P.ink);
      p.line([[42,67],[58,14],[64,67],[46,14]], gold, 4);
      p.rect(48, 12, 7, 64, P.steel);
      p.oval(51.5, 16, 8, 8, P.light, P.ink, 3);
      p.oval(51.5, 16, 3, 3, P.ink);
      p.rect(42, 65, 21, 8, P.rust);
      p.rect(48, 76, 9, 13, P.light);
      p.poly([[42,84],[62,84],[52,98]], gold);
      p.line([[47,86+phase],[58,89+phase]], P.ink, 2);
      if (active) {
        p.oval(81, 34 - phase * 4, 6, 5, '#a3ad95');
        p.oval(86, 25 - phase * 4, 8, 4, '#c2c6ab');
      }
      if (o.upgrades)
        rigParts(p, o.upgrades, gold);
      break;
    case 'shield':
      p.poly([[50,8],[84,21],[81,60],[50,91],[19,60],[16,21]], gold, P.ink, 3);
      p.poly([[50,18],[73,28],[70,56],[50,78]], P.goldHi);
      p.line([[34,47],[47,60],[68,35]], P.ink, 5);
      break;
    case 'bit':
      p.rect(33, 11, 34, 17, P.ink);
      p.rect(38, 28, 24, 18, P.steel);
      p.poly([[22,40],[78,40],[50,94]], gold, P.ink, 3);
      p.line([[25,45],[66,57],[36,65],[57,76]], P.light, 4);
      break;
    case 'repair':
    case 'demolish':
      p.line([[22,79],[69,27]], id === 'repair' ? P.steel : P.rust, 14);
      p.poly([[50,22],[58,8],[65,26],[77,29],[88,17],[90,35],[73,48],[57,40]], P.steel, P.ink, 3);
      p.oval(22, 79, 5, 5, P.ink);
      if (id === 'demolish') {
        p.line([[19,19],[82,82]], gold, 10);
        p.poly([[6,25],[22,9],[41,18],[23,38]], P.ink);
      }
      break;
    case 'claw':
      p.rect(43, 7, 14, 39, P.steel);
      p.oval(50, 44, 11, 11, gold, P.ink, 3);
      p.line([[43,46],[19,60],[24,84],[38,70]], P.steel, 7);
      p.line([[57,46],[81,60],[76,84],[62,70]], P.steel, 7);
      break;
    case 'radar':
      p.rect(40, 71, 20, 12, P.steel);
      p.rect(27, 83, 46, 7, P.ink);
      p.line([[50,75],[50,41]], P.ink, 6);
      p.poly([[21,20],[70,67],[81,26],[59,10]], P.blue, P.ink, 3);
      p.line([[36,34],[81,18]], P.light, 4);
      p.oval(82, 17, 6, 6, gold);
      break;
    case 'crate':
      p.poly([[12,31],[65,16],[89,33],[37,48]], P.goldHi, P.ink, 2);
      p.poly([[12,31],[37,48],[37,89],[12,72]], P.rust, P.ink, 2);
      p.poly([[37,48],[89,33],[89,75],[37,89]], gold, P.ink, 2);
      p.line([[28,28],[52,44],[52,85]], P.ink, 5);
      p.line([[52,20],[76,36],[76,79]], P.ink, 5);
      break;
    case 'book':
      p.poly([[16,18],[76,10],[87,20],[87,80],[25,91],[16,80]], P.ink);
      p.poly([[25,20],[82,15],[82,77],[25,86]], P.cream);
      p.poly([[16,18],[70,8],[76,15],[76,70],[16,80]], P.blue);
      p.line([[30,33],[64,28]], P.light, 3);
      p.line([[30,43],[58,39]], P.light, 3);
      p.rect(22, 18, 3, 57, P.ink);
      break;
    case 'power':
      p.poly([[50,5],[19,56],[40,56],[34,94],[82,38],[58,38],[72,5]], gold, P.ink, 3);
      break;
    case 'worm':
      p.line([[13,75],[24,52],[41,60],[55,36],[71,42],[83,23]], P.ink, 19);
      p.line([[13,75],[24,52],[41,60],[55,36],[71,42],[83,23]], P.rose, 13);
      p.oval(83, 23, 11, 12, '#e6b29e');
      p.oval(80, 19, 2, 3, P.ink);
      break;
    case 'cat':
      p.oval(50, 65, 23, 25, P.cream);
      p.line([[30,76],[14,66],[15,48]], P.cream, 9);
      p.poly([[33,40],[31,12],[48,25],[68,13],[70,40]], P.cream);
      p.oval(51, 40, 22, 18, P.cream);
      p.oval(43, 38, 3, 4, P.ink);
      p.oval(60, 38, 3, 4, P.ink);
      p.poly([[48,46],[56,46],[52,51]], P.rust);
      p.rect(35, 82, 10, 10, P.cream);
      p.rect(60, 82, 10, 10, P.cream);
      break;
    case 'toad':
      p.oval(50, 57, 35, 27, '#916e70', P.ink, 3);
      p.oval(28, 30, 12, 13, P.rose);
      p.oval(72, 30, 12, 13, P.rose);
      p.oval(28, 30, 4, 6, P.ink);
      p.oval(72, 30, 4, 6, P.ink);
      p.line([[29,60],[50,67],[71,60]], P.ink, 3);
      p.oval(15, 80, 11, 6, P.rose);
      p.oval(85, 80, 11, 6, P.rose);
      break;
    case 'grit':
      p.poly([[9,96],[18,76],[37,60],[64,60],[83,76],[92,96]], P.blue);
      p.poly([[33,67],[50,91],[68,67],[50,75]], P.cream);
      p.rect(40, 52, 22, 24, '#a96f4d');
      p.poly([[24,30],[70,27],[78,50],[64,73],[43,70],[28,54]], '#cd9c70');
      p.poly([[23,30],[26,15],[40,6],[61,8],[73,19],[75,31]], gold, P.ink, 2);
      p.rect(18, 28, 64, 7, P.goldHi);
      p.rect(50, 10, 5, 18, P.rust);
      p.oval(53, 20, 9, 9, P.ink);
      p.oval(53, 20, 5, 5, P.cream);
      p.rect(25, 38, 50, 13, P.ink);
      p.rect(29, 41, 17, 7, P.blue);
      p.rect(55, 41, 16, 7, P.blue);
      p.line([[48,47],[44,55],[54,55]], '#89583d', 2);
      p.poly([[33,58],[44,54],[51,59],[58,54],[69,59],[62,65],[40,64]], P.ink);
      p.rect(45, 67, o.talking ? 16 : 13, o.talking ? 4 : 2, '#684d3a');
      p.line([[60,65],[78,68]], P.cream, 3);
      p.oval(79, 68, 2, 2, P.red);
      p.line([[24,80],[31,96]], P.gold, 5);
      p.line([[70,80],[64,96]], P.gold, 5);
      break;
    case 'seal':
      p.oval(50, 50, 40, 40, P.rust, P.ink, 2);
      p.oval(50, 50, 30, 30, P.goldHi);
      gear(p, 50, 50, 23, P.rust, 0);
      p.poly([[45,36],[57,36],[51,64]], P.cream);
      break;
    case 'skull':
      p.oval(50, 43, 32, 30, P.cream, P.ink, 3);
      p.rect(33, 60, 34, 23, P.cream);
      p.oval(37, 43, 8, 9, P.ink);
      p.oval(63, 43, 8, 9, P.ink);
      p.poly([[50,51],[44,63],[56,63]], P.ink);
      p.line([[44,70],[44,83]], P.ink, 2);
      p.line([[55,70],[55,83]], P.ink, 2);
      break;
    case 'anvil':
      p.poly([[7,30],[89,30],[83,45],[65,51],[61,70],[78,80],[22,80],[30,70],[30,51],[14,45]], P.steel, P.ink, 3);
      p.rect(17, 25, 70, 7, P.light);
      break;
    case 'bell':
      p.oval(50, 20, 6, 9, P.rust);
      p.poly([[40,23],[60,23],[70,65],[84,76],[16,76],[30,65]], gold, P.ink, 3);
      p.rect(15, 74, 70, 7, P.goldHi);
      p.oval(50, 85, 7, 7, P.rust);
      p.line([[40,30],[34,63]], P.goldHi, 4);
      break;
    case 'pool':
    case 'warm':
      p.oval(50, 58, 43, 26, P.ink);
      p.oval(50, 54, 39, 22, id === 'warm' ? '#937347' : P.blue);
      p.oval(50, 50, 29, 13, null, id === 'warm' ? P.goldHi : P.light, 2);
      p.line([[28,50],[42,45],[67,50]], P.light, 2);
      break;
    case 'root':
      p.line([[50,6],[43,33],[57,59],[46,92]], P.violet, 14);
      p.line([[44,30],[26,23],[14,30]], P.violet, 7);
      p.line([[55,60],[77,40],[86,49]], P.violet, 7);
      p.line([[40,80],[22,91]], P.violet, 7);
      p.line([[50,9],[40,33],[55,62]], '#c5aed7', 3);
      break;
    case 'magma':
      p.poly([[6,65],[16,41],[35,45],[53,18],[72,40],[92,36],[89,70],[70,86],[27,82]], P.red, P.ink, 2);
      p.line([[18,64],[38,54],[51,36],[66,61],[80,50]], P.goldHi, 7);
      break;
    case 'rock':
    case 'obsidian':
    case 'rubble':
      p.poly([[10,60],[27,27],[60,18],[88,40],[80,80],[35,86]], id === 'obsidian' ? '#566573' : '#928f70', P.ink, 3);
      p.poly([[27,27],[60,18],[88,40],[52,55]], id === 'obsidian' ? '#819391' : '#b3ad88');
      p.line([[52,55],[35,86]], P.ink, 2);
      break;
    case 'chasm':
      p.oval(50, 50, 43, 30, P.steel);
      p.oval(50, 54, 38, 20, P.ink);
      p.oval(50, 58, 28, 12, P.deep);
      break;
    case 'pause':
      p.rect(20, 18, 22, 64, P.light);
      p.rect(58, 18, 22, 64, P.light);
      break;
    case 'fullscreen':
      for (const [x,y,dx,dy] of [[16,16,1,1],[84,16,-1,1],[16,84,1,-1],[84,84,-1,-1]])
        p.line([[x+dx*21,y],[x,y],[x,y+dy*21]],P.light,7);
      break;
    case 'sound':
    case 'muted':
      p.poly([[12,39],[30,39],[50,20],[50,80],[30,61],[12,61]], P.light);
      if (id === 'sound') {
        p.line([[65,32],[75,50],[65,68]], P.light, 5);
        p.line([[78,20],[92,50],[78,80]], P.light, 4);
      } else {
        p.line([[65,36],[87,64]], P.rust, 6);
        p.line([[87,36],[65,64]], P.rust, 6);
      }
      break;
    case 'rotate':
      p.line([[20,52],[20,26],[50,13],[80,30],[82,60],[59,80],[38,75]], P.light, 7);
      arrow(p, 0, P.light, 20, 50, 22);
      break;
    case 'inspect':
      p.oval(42, 42, 25, 25, null, P.light, 7);
      p.line([[60,60],[86,86]], P.rust, 10);
      break;
    case 'down':
      arrow(p, 2, P.green, 50, 50, 50);
      break;
    case 'trophy':
      p.poly([[28,15],[72,15],[68,55],[50,70],[32,55]], gold, P.ink, 3);
      p.line([[27,20],[12,23],[17,40],[34,48]], gold, 6);
      p.line([[73,20],[88,23],[83,40],[66,48]], gold, 6);
      p.rect(45, 66, 10, 16, P.rust);
      p.rect(29, 82, 42, 9, P.ink);
      break;
    case 'clock':
      p.oval(50, 50, 38, 38, P.goldHi, P.ink, 4);
      p.oval(50, 50, 29, 29, P.cream);
      p.line([[50,27],[50,50],[67,59]], P.ink, 4);
      p.rect(44, 3, 12, 9, P.steel);
      break;
    case 'leaf':
      p.poly([[50,90],[40,60],[17,63],[28,46],[8,29],[37,35],[50,7],[62,36],[88,25],[73,48],[88,60],[63,61]], P.green, P.ink, 3);
      p.line([[50,90],[50,30]], P.light, 3);
      break;
    case 'helmet':
      p.poly([[15,65],[20,31],[39,15],[62,15],[80,31],[85,65]], gold, P.ink, 3);
      p.rect(6, 65, 88, 10, P.goldHi);
      p.rect(45, 12, 10, 52, P.rust);
      p.oval(50, 50, 13, 13, P.ink);
      p.oval(50, 50, 8, 8, P.cream);
      break;
    default:
      gear(p, 50, 50, 35, gold, 0);
      break;
    }
  }
  function rigParts(p, u, gold) {
    if (u.m_stock)
      p.rect(4, 58, 17, 14, gold);
    if (u.m_hull) {
      p.rect(10, 68, 80, 5, P.light);
      p.line([[20,68],[80,68]], P.ink, 1);
    }
    if (u.m_damp) {
      p.rect(4, 74, 6, 18, P.green);
      p.rect(89, 74, 6, 18, P.green);
    }
    if (u.m_torque) {
      p.rect(45, 28, 13, 31, P.goldHi);
      p.line([[44,37],[58,46],[44,55]], P.ink, 2);
    }
    if (u.m_fix) {
      p.rect(29, 55, 12, 11, P.cream);
      p.rect(34, 56, 3, 8, P.red);
      p.rect(31, 59, 9, 3, P.red);
    }
    if (u.m_scan) {
      p.line([[28,50],[28,31]], P.light, 2);
      p.poly([[17,30],[38,30],[28,40]], P.blue);
    }
    if (u.m_salv)
      p.line([[84,54],[98,60],[95,75]], P.light, 4);
    if (u.m_deep) {
      p.rect(74, 55, 5, 14, P.violet);
      p.rect(82, 55, 5, 14, P.violet);
    }
    if (u.m_schem) {
      p.rect(35, 37, 6, 14, P.blue);
      p.rect(38, 40, 2, 7, P.white);
    }
  }
  // Large illustrations have their own fine members and service equipment;
  // they are not enlarged toolbar icons.
  function portraitRig(c, x, y, w, h, o) {
    const p = canvasPen(c, x, y, w, h), g = o.accent || P.gold, u = o.upgrades || {};
    p.oval(50, 89, 46, 5, '#132c28');
    p.rect(9, 74, 82, 12, P.ink);
    p.rect(11, 75, 78, 8, '#5d7770');
    for (let i = 0; i < 12; i++) {
      const a = 14 + i * 6.5;
      p.oval(a, 80, 3.5, 3.7, P.ink);
      p.oval(a, 80, 1.8, 1.9, P.steel);
      p.rect(a - 2, 73, 4, 2, P.light);
      p.rect(a - 2, 85, 4, 2, '#6b8276');
    }
    p.poly([[8,71],[90,71],[94,75],[8,75]], g);
    p.rect(10, 71, 80, 1.3, P.goldHi);
    p.poly([[12,52],[35,52],[39,56],[39,70],[12,70]], g, P.ink, 0.7);
    p.rect(15, 55, 19, 10, '#243c3c');
    p.rect(16, 56, 7, 8, '#4297c0');
    p.rect(25, 56, 8, 8, '#53bad1');
    p.poly([[16,56],[22,56],[16,62]], '#b2f3ed');
    p.rect(15, 66, 19, 0.8, P.ink);
    p.rect(28, 66, 3, 1.1, P.cream);
    p.line([[11,51],[36,51],[40,55]], P.ink, 1.2);
    p.rect(12, 69, 27, 1.2, '#846238');
    p.rect(17, 71, 1, 6, P.steel);
    p.rect(30, 71, 1, 6, P.steel);
    p.line([[17,77],[31,77]], P.steel, 1);
    p.poly([[42,71],[48,12],[60,12],[69,71]], P.ink);
    p.poly([[45,70],[50,16],[58,16],[65,70]], '#517167');
    p.line([[43,71],[49,12],[59,12],[68,71]], g, 2.4);
    for (let i = 0; i < 6; i++) {
      const yy = 22 + i * 8, left = 48 - i * 0.65, right = 61 + i * 0.7;
      p.line([[left,yy],[right,yy+7],[left-0.6,yy+8]], g, 1.1);
    }
    p.rect(52, 16, 1.5, 57, P.light);
    p.rect(57, 15, 0.6, 57, P.cream);
    p.oval(54, 14, 5.4, 5.4, P.ink);
    p.oval(54, 14, 4.2, 4.2, P.steel);
    p.oval(54, 14, 2.8, 2.8, '#49655d');
    p.oval(54, 14, 1, 1, P.cream);
    p.rect(50, 44, 10, 12, P.ink);
    p.rect(51, 45, 8, 10, P.rust);
    p.rect(53, 46, 4, 8, P.goldHi);
    p.rect(52, 56, 5, 23, P.steel);
    p.rect(51, 73, 7, 5, P.cream);
    p.poly([[47,78],[62,78],[59,84],[54,91],[49,84]], P.steel, P.ink, 0.7);
    p.line([[48,79],[60,81],[50,84],[57,86]], P.ink, 1.3);
    p.line([[63,24],[72,70]], P.steel, 1);
    p.line([[66,24],[75,70]], P.steel, 1);
    for (let i = 0; i < 10; i++)
      p.line([[63+i*0.95,25+i*4.5],[66+i*0.95,25+i*4.5]], P.light, 0.7);
    p.rect(74, 56, 13, 14, P.rust);
    p.poly([[74,56],[78,53],[90,53],[87,56]], '#d68f5d');
    p.poly([[87,56],[90,53],[90,68],[87,70]], '#84553d');
    for (let i = 0; i < 5; i++)
      p.rect(77, 59 + i * 1.5, 7, 0.65, '#5b4d39');
    p.rect(81, 45, 3, 11, P.ink);
    p.rect(80, 45, 5, 1.6, P.steel);
    p.line([[75,68],[70,65],[60,65],[60,70]], P.ink, 2);
    p.line([[73,60],[71,49],[65,48]], '#b2afa0', 1);
    p.line([[9,62],[9,71]], P.light, 0.7);
    p.line([[38,62],[38,71]], P.light, 0.7);
    p.line([[9,62],[38,62]], P.light, 0.8);
    p.rect(39, 67, 28, 5, P.rust);
    p.rect(41, 68, 24, 0.8, '#d99565');
    for (const [a, b] of [[14,53],[33,53],[14,69],[35,69],[41,70],[64,70],[76,57],[85,68]])
      p.oval(a, b, 0.65, 0.65, P.cream);
    p.rect(17, 48, 3, 3, P.ink);
    p.oval(18.5, 48, 1.4, 0.6, P.goldHi);
    if (u.m_stock) {
      p.rect(2, 63, 9, 8, g);
      p.line([[4,63],[4,71],[9,71],[9,63]], P.ink, 0.8);
    }
    if (u.m_hull) {
      p.rect(11, 69, 77, 2, P.light);
      p.line([[13,70],[87,70]], P.ink, 0.4);
    }
    if (u.m_damp) {
      p.rect(8, 79, 2, 13, P.green);
      p.rect(91, 79, 2, 13, P.green);
      p.rect(5, 91, 8, 2, P.light);
      p.rect(88, 91, 8, 2, P.light);
    }
    if (u.m_torque) {
      p.rect(49, 34, 12, 5, P.goldHi);
      p.rect(49, 41, 12, 3, P.goldHi);
    }
    if (u.m_fix) {
      p.rect(34, 60, 5, 6, P.cream);
      p.rect(36, 61, 1, 4, P.red);
      p.rect(35, 62.5, 3, 1, P.red);
    }
    if (u.m_scan) {
      p.line([[28,51],[28,41]], P.light, 1);
      p.poly([[21,39],[35,39],[28,45]], P.blue);
      p.line([[28,42],[33,35]], P.light, 0.8);
    }
    if (u.m_salv)
      p.line([[89,64],[98,68],[97,79],[94,80]], P.light, 2);
    if (u.m_deep) {
      p.rect(6, 58, 2, 5, P.violet);
      p.rect(9, 58, 2, 5, P.violet);
    }
    if (u.m_schem) {
      p.rect(34, 46, 5, 6, P.blue);
      p.line([[35,48],[38,48]], P.cream, 0.5);
    }
  }
  function icon(id, o) {
    const out = ['<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 100 100" aria-hidden="true" focusable="false">'];
    draw(id, svgPen(out), o);
    out.push('</svg>');
    return out.join('');
  }
  function sprite(c, id, x, y, w, h, o) {
    draw(id, canvasPen(c, x, y, w, h), o);
  }
  // Material palettes are authored independently from the terminal colours.
  const BIOMES = [
    {
      ground: '#173641', floor: '#285565', wall: '#337d82',
      edge: '#69c4a9', dark: '#102536'
    },
    {
      ground: '#392c42', floor: '#654058', wall: '#b36a51',
      edge: '#ffb778', dark: '#292037'
    },
    {
      ground: '#153c3a', floor: '#246353', wall: '#349975',
      edge: '#9cde83', dark: '#122c31'
    },
    {
      ground: '#1a314c', floor: '#29577a', wall: '#4085a8',
      edge: '#86d7ec', dark: '#13243d'
    },
    {
      ground: '#302b50', floor: '#49406b', wall: '#765b9f',
      edge: '#c397ed', dark: '#211e3a'
    },
    {
      ground: '#422c37', floor: '#6f3a40', wall: '#a5564e',
      edge: '#f39263', dark: '#2d2333'
    },
    {
      ground: '#20263f', floor: '#353c62', wall: '#4e598a',
      edge: '#889ed7', dark: '#151b30'
    },
    {
      ground: '#433344', floor: '#695052', wall: '#b08156',
      edge: '#ffdb80', dark: '#2b2539'
    }
  ];
  function tile(c, v, x, y, s) {
    const b = BIOMES[(v.biome || 0) % BIOMES.length], p = canvasPen(c, x, y, s, s), k = v.kind, n = v.variant || 0;
    p.rect(0, 0, 100, 100, b.ground);
    if (k === 'rock' || k === 'obsidian') {
      const wall = k === 'obsidian' ? '#454769' : b.wall, edge = k === 'obsidian' ? '#a193d4' : b.edge;
      p.rect(0, 0, 100, 100, wall);
      // Broad facets and a deep front face: rock, not a tiled spreadsheet.
      p.poly([[0,12+n*2],[34,5],[81,12],[100,31],[79,54],[20,49]], mix(wall, edge, 0.15));
      p.poly([[20,49],[79,54],[100,31],[100,88],[57,94],[9,80]], mix(wall, b.dark, 0.12));
      if (n % 3 === 0)
        p.line([[12,71],[34,59],[51,65]], mix(wall, b.dark, 0.45), 3);
      if (v.edges & 1) {
        p.poly([[0,0],[100,0],[100,9],[63,15],[26,8],[0,16]], b.dark);
        p.line([[0,17],[26,9],[63,16],[100,10]], edge, 5);
      }
      if (v.edges & 4) {
        p.poly([[0,67],[27,72],[70,64],[100,69],[100,100],[0,100]], b.dark);
        p.poly([[0,67],[27,72],[70,64],[100,69],[100,83],[61,80],[21,87],[0,81]], mix(wall,b.dark,0.5));
        p.line([[0,66],[27,71],[70,63],[100,68]], edge, 4);
      }
      if (v.edges & 2)
        p.rect(0, 5, 7, 80, b.dark);
      if (v.edges & 8)
        p.rect(93, 5, 7, 80, b.dark);
    } else if (k === 'chasm') {
      p.rect(0, 0, 100, 100, '#080f25');
      p.rect(0, 0, 100, 12, b.dark);
      p.line([[13,20],[26,17],[40,20]], '#30434a', 2);
    } else if (k === 'magma') {
      p.rect(0, 0, 100, 100, '#b63654');
      p.poly([[0,25],[30,9],[64,28],[100,18],[100,66],[64,83],[20,61],[0,79]], '#f87246');
      p.line([[0,34],[33,21],[64,40],[100,32]], '#ffdd73', 7);
      p.line([[20,80],[45,68],[70,77]], '#ffb650', 4);
    } else {
      p.rect(0, 0, 100, 100, mix(b.ground, b.floor, n % 4 * 0.025));
      if (n % 3 === 0) {
        p.oval(27, 64, 5, 3, mix(b.floor, b.edge, 0.13));
        p.oval(71, 27, 3, 2, b.floor);
      }
      if (n === 4)
        p.line([[12,84],[19,73],[23,80]], b.floor, 3);
      if (v.biome === 0 && n === 5) {
        p.line([[78,81],[70,60],[78,70],[86,59]], '#54af92', 3);
      }
    }
    if (v.ore && !v.rubble) {
      p.oval(50, 60, 40, 26, b.dark);
      sprite(c, v.ore, x + s * 0.11, y + s * 0.05, s * 0.78, s * 0.8, {});
    }
    if (v.rubble) {
      sprite(c, 'rock', x, y + s * 0.18, s * 0.6, s * 0.6);
      sprite(c, 'rock', x + s * 0.4, y + s * 0.3, s * 0.55, s * 0.55);
    }
  }
  function landscape(c, w, h, o) {
    o = o || {};
    const p = canvasPen(c, 0, 0, w, h), gold = o.accent || P.gold;
    p.rect(0, 0, 100, 100, '#101a36');
    // A cavern diorama. The title uses a wide composition; the Foundry keeps
    // the rig centered. Nothing in this illustration pretends to be live sim.
    const wide = !!o.title && w > h * 1.1, center = wide ? 70 : 51;
    p.oval(center, 44, 36, 43, '#17264a');
    p.oval(center, 44, 27, 35, '#1c3553');
    p.oval(center, 45, 17, 27, '#204b5d');
    p.poly([[0,0],[100,0],[100,24],[88,12],[83,27],[73,9],[61,18],[48,7],[36,29],[24,12],[13,35],[0,21]], '#162d47');
    p.poly([[0,0],[100,0],[100,9],[82,5],[72,14],[55,3],[35,13],[17,7],[0,16]], '#0b142d');
    p.poly([[0,55],[12,40],[22,62],[35,50],[46,67],[64,51],[80,62],[92,37],[100,53],[100,100],[0,100]], '#244563');
    p.poly([[0,69],[17,56],[30,74],[43,62],[60,78],[76,63],[91,73],[100,57],[100,100],[0,100]], '#18324d');
    p.poly([[0,86],[18,74],[37,84],[55,75],[72,88],[91,76],[100,85],[100,100],[0,100]], '#0b1932');
    // Luminous mineral seams and faceted hanging rocks frame the play space.
    for (let i = 0; i < 12; i++) {
      const xx = (i * 23 + 7) % 99, yy = 24 + (i * 13) % 45;
      p.poly([[xx,yy-0.6],[xx+0.35,yy],[xx,yy+0.6],[xx-0.35,yy]], i % 2 ? '#71e0d3' : '#d2a4fc');
    }
    const size = Math.min(w * (wide ? 0.48 : 0.9), h * 0.88);
    const rx = w * center / 100 - size * 0.5, ry = h * 0.77 - size * 0.88;
    const shelf = canvasPen(c, rx - size * 0.08, ry, size * 1.16, size);
    shelf.poly([[0,83],[22,72],[75,73],[100,82],[74,94],[22,96]], '#367c86', P.ink, 1);
    shelf.poly([[0,83],[22,96],[74,94],[74,111],[27,115],[0,99]], '#254e70', P.ink, 1);
    shelf.poly([[74,94],[100,82],[100,101],[74,111]], '#173a5b', P.ink, 1);
    shelf.line([[4,90],[28,104],[68,101]], '#4587a3', 2);
    shelf.line([[79,100],[96,91]], '#53c5c4', 2);
    sprite(c,'crystal',rx+size*0.84,ry+size*0.64,size*0.25,size*0.25);
    sprite(c,'copperOre',rx-size*0.03,ry+size*0.82,size*0.2,size*0.15);
    if (o.wreck) {
      c.save();
      c.translate(rx + size * 0.5, ry + size * 0.8);
      c.rotate(-0.22);
      portraitRig(c, -size * 0.5, -size * 0.8, size, size, o);
      c.restore();
    } else
      portraitRig(c, rx, ry, size, size, o);
    if (o.cat)
      sprite(c, 'cat', rx + size * 0.11, ry + size * 0.36, size * 0.095, size * 0.095);
    sprite(c,'crystal',w*0.9,h*0.79,w*0.11,h*0.24);
    p.poly([[0,88],[6,80],[12,90],[17,89],[22,100],[0,100]], '#081127');
    // A warning stripe ties the illustrated world to the arcade cabinet.
    for (let i = 0; i < 4; i++)
      shelf.poly([[16+i*9,90],[19+i*9,92],[23+i*9,88],[20+i*9,87]], gold);
  }
  function scene(c, id, w, h, o) {
    o = o || {};
    if (id === 'landscape' || id === 'rig' || id === 'wreck') {
      landscape(c, w, h, Object.assign({}, o, { wreck: id === 'wreck' }));
      return;
    }
    const p = canvasPen(c, 0, 0, w, h);
    p.rect(0, 0, 100, 100, '#203a35');
    p.poly([[0,0],[22,0],[13,41],[24,70],[8,100],[0,100]], '#395147');
    p.poly([[100,0],[81,0],[90,30],[78,75],[90,100],[100,100]], '#304940');
    p.poly([[0,86],[28,75],[52,84],[74,73],[100,87],[100,100],[0,100]], '#182f2b');
    if (id === 'core') {
      p.oval(50, 49, 33, 36, '#3a4c36');
      p.oval(50, 49, 27, 30, '#756e42');
      p.oval(50, 49, 22, 25, '#b69b55');
      p.oval(45, 44, 18, 20, '#ead28d');
      p.line([[51,25],[44,40],[57,49],[45,62],[50,76]], P.ink, 2.5);
      p.line([[44,40],[34,43]], P.ink, 1.5);
      p.oval(50, 49, 31, 34, null, '#aaa06b', 0.5);
      return;
    }
    if (id === 'descent') {
      p.rect(37, 0, 26, 100, '#142a29');
      p.rect(42, 0, 3, 66, P.steel);
      p.rect(55, 0, 3, 66, P.steel);
      p.rect(37, 50, 26, 15, P.rust);
      p.poly([[33,65],[67,65],[50,85]], P.gold);
      p.line([[37,70],[61,74],[43,79]], P.light, 2);
      for (let i = 0; i < 7; i++) {
        p.line([[10,6+i*14],[30,13+i*14]], '#61735a', 1);
        p.line([[70,13+i*14],[90,6+i*14]], '#61735a', 1);
      }
      return;
    }
    const object = (subject, x, y, size, extra) => sprite(c, subject, w * x / 100, h * y / 100, w * size / 100, h * size / 100, extra || {});
    // Twenty authored expedition tableaux. Their objects follow the prose;
    // no event is represented by a generic gear or a recoloured placeholder.
    switch (id) {
    case 'vault':
      p.rect(19, 17, 64, 68, '#657367');
      p.rect(24, 21, 54, 60, '#94a18a');
      p.rect(28, 25, 46, 52, '#3d554e');
      p.line([[30,29],[70,72]], P.rust, 3);
      p.line([[70,29],[30,72]], P.rust, 3);
      p.oval(52, 51, 13, 13, P.steel, P.ink, 2);
      p.oval(52, 51, 4, 4, P.ink);
      for (const y of [31,64])
        p.rect(22, y, 10, 8, P.ink);
      break;
    case 'crack':
      p.poly([[43,0],[58,0],[50,25],[63,41],[45,68],[54,100],[37,100],[38,64],[51,39],[39,22]], '#0d2024');
      p.line([[51,8],[44,24],[56,41],[40,68],[45,94]], '#80b6a5', 1.6);
      p.line([[17,43],[27,37],[30,54]], '#5d7f6c', 1);
      break;
    case 'drone':
      p.oval(50, 79, 22, 4, '#112b28');
      p.line([[29,38],[13,26],[7,29]], P.steel, 2);
      p.line([[70,38],[86,26],[94,29]], P.steel, 2);
      p.oval(11, 25, 12, 2, P.light);
      p.oval(89, 25, 12, 2, P.light);
      p.poly([[29,30],[70,30],[78,49],[67,58],[33,58],[22,49]], P.steel, P.ink, 2);
      p.oval(50, 43, 10, 10, P.ink);
      p.oval(50, 43, 5, 5, P.rust);
      p.line([[62,55],[73,68],[66,76]], P.steel, 2);
      p.rect(57, 68, 16, 18, P.cream);
      for (let i = 0; i < 4; i++)
        p.rect(59, 72 + i * 3, 11, 0.8, P.ink);
      break;
    case 'pool':
      p.oval(50, 67, 38, 19, '#657a60');
      p.oval(50, 67, 33, 15, '#789f89');
      p.oval(50, 65, 24, 9, null, P.light, 0.8);
      p.line([[39,57],[36,46],[40,36]], '#9aac92', 1);
      p.line([[60,53],[64,43],[59,32]], '#9aac92', 1);
      break;
    case 'ghost':
      p.oval(50, 79, 13, 3, '#112b28');
      p.oval(50, 47, 24, 28, '#566650');
      p.oval(50, 47, 18, 23, '#7d8358');
      p.line([[43,31],[43,23],[57,23],[57,31]], P.steel, 2);
      p.rect(38, 32, 24, 4, P.ink);
      p.rect(42, 36, 16, 22, P.goldHi);
      p.line([[40,36],[40,58],[60,58],[60,36]], P.ink, 2);
      p.rect(37, 59, 26, 4, P.ink);
      break;
    case 'crate':
      object('crate', 20, 31, 61);
      p.poly([[27,36],[61,24],[81,34],[45,47]], '#131f23');
      p.line([[29,29],[63,17],[82,27]], P.goldHi, 4);
      p.oval(49, 39, 2, 1.5, '#d9d497');
      p.oval(57, 36, 2, 1.5, '#d9d497');
      break;
    case 'rations':
      p.rect(17, 75, 65, 5, P.rust);
      p.rect(20, 80, 9, 5, P.ink);
      p.rect(70, 80, 9, 5, P.ink);
      for (const [x, y] of [[24,52],[44,52],[64,52],[34,32],[54,32]]) {
        p.rect(x, y, 17, 22, '#829375');
        p.oval(x + 8.5, y, 8.5, 3, P.light);
        p.rect(x + 3, y + 8, 11, 7, P.cream);
        p.line([[x+5,y+11],[x+12,y+11]], P.rust, 1.3);
      }
      break;
    case 'ladder':
      p.line([[40,-5],[35,91]], P.steel, 3);
      p.line([[60,-5],[55,91]], P.steel, 3);
      for (let i = 0; i < 10; i++)
        p.line([[40-i*0.5,i*9],[60-i*0.5,i*9]], '#a7b39c', 2);
      p.poly([[28,0],[72,0],[63,17],[38,12]], '#344d40');
      break;
    case 'door':
      p.rect(27, 15, 47, 72, '#929e86');
      p.rect(31, 18, 39, 68, '#795f40');
      p.rect(36, 23, 29, 50, '#4c4c38');
      p.rect(39, 31, 23, 8, P.gold);
      p.line([[43,35],[58,35]], P.ink, 1);
      p.oval(63, 57, 2, 2, P.goldHi);
      p.rect(31, 84, 39, 3, P.ink);
      break;
    case 'tally':
      p.poly([[15,17],[82,20],[88,76],[21,83]], '#67745a');
      for (let row = 0; row < 3; row++)
        for (let col = 0; col < 2; col++) {
          const x = 25 + col * 30, y = 29 + row * 17;
          for (let j = 0; j < (row === 2 && col === 1 ? 2 : 4); j++)
            p.line([[x+j*5,y],[x+j*5-2,y+10]], P.cream, 1);
          if (!(row === 2 && col === 1))
            p.line([[x-3,y+9],[x+18,y+2]], P.cream, 1);
        }
      break;
    case 'seam':
      p.poly([[11,50],[34,26],[64,31],[89,63],[76,81],[41,67],[21,76]], '#738771');
      for (const [x, y, s] of [[15,45,24],[34,31,30],[57,45,28],[39,61,20]])
        object('ironOre', x, y, s);
      break;
    case 'terminal':
      p.rect(29, 23, 45, 37, P.steel);
      p.rect(33, 27, 37, 27, '#132d29');
      for (let i = 0; i < 4; i++)
        p.rect(37, 32 + i * 4, 23 - i * 3, 1.5, '#8bab83');
      p.rect(40, 60, 23, 19, '#778a78');
      p.poly([[29,60],[74,60],[80,68],[23,68]], P.ink);
      p.rect(30, 65, 42, 1, P.light);
      p.rect(32, 79, 40, 5, P.steel);
      break;
    case 'sump':
      p.oval(50, 67, 40, 22, '#486e67');
      object('gear', 31, 39, 40);
      p.poly([[14,66],[38,61],[58,67],[80,62],[85,80],[19,85]], '#254b4a');
      p.line([[23,70],[43,68],[63,74],[75,70]], '#799d8e', 1.2);
      break;
    case 'watchman':
      portraitRig(c, w * 0.12, h * 0.07, w * 0.76, h * 0.76, {
        accent: '#7b8b73',
        upgrades: {}
      });
      p.oval(33, 47, 8, 8, '#b6a66b');
      p.oval(33, 47, 3, 3, P.goldHi);
      for (let i = 0; i < 5; i++)
        object('rock', 12 + i * 15, 75 + i % 2 * 3, 17);
      break;
    case 'coin':
      p.oval(50, 70, 23, 7, P.ink);
      p.oval(50, 60, 19, 21, P.rust);
      p.oval(48, 58, 17, 20, P.gold);
      p.oval(48, 58, 13, 16, null, P.goldHi, 1);
      p.poly([[40,51],[54,51],[48,68]], P.rust);
      break;
    case 'crossing':
      p.poly([[0,45],[100,27],[100,50],[0,70]], '#102b29');
      p.poly([[36,100],[55,0],[73,0],[57,100]], '#112a27');
      p.line([[0,57],[100,39]], '#6a7b66', 1.3);
      p.line([[45,100],[65,0]], '#6a7b66', 1.3);
      p.oval(86, 38, 2, 2, P.goldHi);
      break;
    case 'suit':
      p.oval(28, 66, 8, 8, '#a9967a');
      p.poly([[36,60],[65,55],[72,70],[40,77]], '#858b7c');
      p.line([[65,59],[86,61]], P.ink, 6);
      p.line([[69,68],[88,76]], P.ink, 6);
      p.poly([[40,63],[51,64],[44,70]], P.cream);
      p.line([[40,66],[53,68]], P.rust, 2);
      object('crate', 60, 70, 20);
      break;
    case 'shrine':
      p.rect(24, 75, 52, 5, P.steel);
      p.rect(30, 70, 40, 4, '#6a8074');
      p.rect(34, 65, 32, 4, P.light);
      object('gear', 33, 35, 34);
      for (const [x, y] of [[19,63],[76,69],[24,79]]) {
        p.rect(x, y, 3, 8, P.cream);
        p.poly([[x-0.5,y-1],[x+1.5,y-7],[x+3.5,y-1]], P.goldHi);
      }
      break;
    case 'wind':
      p.poly([[20,79],[40,61],[66,66],[80,89]], P.ink);
      p.line([[35,80],[42,62],[35,40],[47,23]], '#b5baa1', 1.8);
      p.line([[54,83],[62,61],[50,40],[65,20]], '#809d85', 1.3);
      p.line([[69,80],[73,64],[65,50]], '#809d85', 1);
      break;
    case 'offer':
      p.poly([[44,12],[67,24],[76,59],[64,87],[39,80],[25,53]], '#172328');
      p.oval(50, 51, 17, 27, '#0b171e');
      p.line([[34,23],[26,40],[31,70],[40,80]], P.violet, 1.5);
      p.oval(40, 47, 1.5, 1, P.goldHi);
      p.oval(61, 47, 1.5, 1, P.goldHi);
      break;
    default: {
        const size = Math.min(w * 0.72, h * 0.72);
        sprite(c, o.subject || id, (w - size) / 2, (h - size) / 2, size, size, o);
      }
    }
  }
  DC.Atelier = {
    P,
    BIOMES,
    SUBJECTS,
    draw,
    icon,
    sprite,
    tile,
    scene,
    canvasPen,
    arrow,
    mix,
    portraitRig
  };
}());
