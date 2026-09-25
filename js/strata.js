/* Engraved's hybrid map and icon renderer. Canvas geometry below, semantic
   characters above. Receives revealed visual descriptors only: no run, RNG,
   clock, input, or save access. Classic never loads this module. */
(function () {
  'use strict';
  const root=typeof window!=='undefined'?window:globalThis;
  const DC=root.DC=root.DC||{};
  const ICONS=['ironOre','copperOre','coal','crystal','ironPlate','copperPlate','gear','charge',
    'extractor','smelter','assembler','damper','belt','splitter','filter','tunnel','crusher','loader',
    'demolish','m_stock','m_hull','m_damp','m_torque','m_fix','m_scan','m_salv','m_deep','m_schem'];
  function tone(hex,f) {
    return '#'+[1,3,5].map(i=>Math.max(0,Math.min(255,Math.round(parseInt(hex.slice(i,i+2),16)*f))).toString(16).padStart(2,'0')).join('');
  }
  function pen(c,x,y,w,h) {
    const polygon=(points,color)=>{
      c.beginPath();c.moveTo(x+points[0][0]*w,y+points[0][1]*h);
      for(let i=1;i<points.length;i++)c.lineTo(x+points[i][0]*w,y+points[i][1]*h);
      c.closePath();c.fillStyle=color;c.fill();
    };
    return {
      rect(a,b,d,e,color){c.fillStyle=color;c.fillRect(x+a*w,y+b*h,d*w,e*h);},
      line(a,b,d,e,color,width){c.beginPath();c.moveTo(x+a*w,y+b*h);c.lineTo(x+d*w,y+e*h);c.strokeStyle=color;c.lineWidth=Math.max(.7,(width||.045)*Math.min(w,h));c.stroke();},
      poly:polygon,
      oval(a,b,rx,ry,color){c.beginPath();c.ellipse(x+a*w,y+b*h,rx*w,ry*h,0,0,Math.PI*2);c.fillStyle=color;c.fill();},
    };
  }
  function icon(c,id,x,y,w,h,color) {
    const P=pen(c,x,y,w,h),hi=color||'#d6a257',mid=tone(hi,.6),dark=tone(hi,.22),white='#eee1c4';
    const {rect,line,poly,oval}=P;
    const metal=()=>{rect(.09,.17,.82,.67,mid);rect(.15,.22,.7,.53,dark);line(.1,.17,.9,.17,hi);};
    const gear=()=>{
      const pts=[];
      for(let i=0;i<32;i++){const a=i*Math.PI/16,r=i%4<2?.43:.32;pts.push([.5+Math.cos(a)*r,.5+Math.sin(a)*r]);}
      poly(pts,hi);oval(.5,.5,.2,.2,dark);oval(.5,.5,.085,.085,white);
    };
    switch(id) {
      case 'ironOre':
        // One broad, banded metallic slab: not the same nugget tinted grey.
        poly([[.06,.61],[.22,.19],[.64,.12],[.94,.38],[.82,.83],[.29,.88]],mid);
        poly([[.06,.61],[.22,.19],[.64,.12],[.58,.56]],hi);
        poly([[.58,.56],[.94,.38],[.82,.83],[.29,.88]],dark);
        for(let i=0;i<3;i++)line(.21+i*.12,.32-i*.025,.14+i*.12,.51-i*.025,tone(hi,1.3),.035);
        break;
      case 'copperOre':
        // Broken angular nuggets with a visible gap, rather than iron's slab.
        poly([[.06,.58],[.23,.28],[.46,.4],[.42,.81],[.15,.85]],mid);
        poly([[.06,.58],[.23,.28],[.46,.4],[.29,.61]],hi);
        poly([[.5,.72],[.56,.18],[.79,.12],[.95,.39],[.86,.78]],mid);
        poly([[.56,.18],[.79,.12],[.95,.39],[.7,.43]],hi);
        line(.59,.55,.81,.5,tone(hi,1.2),.045);break;
      case 'coal': {
        // Three matte, fractured lumps. Light rims make black material read
        // on the dark panel, without the broad silver face of metallic ore.
        const lumps=[[[.04,.58],[.09,.4],[.24,.3],[.39,.43],[.35,.75],[.17,.81]],
          [[.47,.68],[.51,.4],[.68,.27],[.87,.35],[.96,.64],[.79,.83],[.59,.83]],
          [[.34,.23],[.37,.09],[.5,.07],[.58,.2],[.49,.3]]];
        for(const points of lumps){
          poly(points,tone(hi,.3));
          for(let i=1;i<points.length;i++)line(...points[i-1],...points[i],tone(hi,.94),.035);
        }
        line(.1,.46,.25,.51,tone(hi,.58),.035);line(.25,.51,.21,.7,tone(hi,.58),.035);
        line(.59,.47,.72,.57,tone(hi,.62),.035);line(.72,.57,.86,.51,tone(hi,.62),.035);
        break;
      }
      case 'crystal':case 'm_deep':
        poly([[.47,.07],[.72,.33],[.62,.88],[.29,.76],[.22,.29]],mid);
        poly([[.47,.07],[.5,.77],[.29,.76],[.22,.29]],hi);
        line(.47,.07,.62,.88,white,.035);break;
      case 'ironPlate':case 'copperPlate':
        poly([[.12,.48],[.67,.24],[.9,.38],[.88,.67],[.35,.85],[.12,.7]],mid);
        poly([[.12,.48],[.67,.24],[.9,.38],[.35,.62]],hi);
        line(.35,.62,.35,.83,dark);break;
      case 'gear':gear();break;
      case 'charge':
        for(let i=0;i<3;i++){rect(.17+i*.22,.3,.19,.47,hi);oval(.265+i*.22,.3,.095,.07,white);}
        rect(.13,.49,.76,.08,dark);line(.53,.26,.68,.09,mid);break;
      case 'extractor':case 'm_torque':
        line(.24,.76,.38,.13,hi,.07);line(.76,.76,.62,.13,hi,.07);
        for(let i=0;i<3;i++)line(.3+i*.04,.68-i*.18,.7-i*.04,.5-i*.18,mid,.06);
        rect(.45,.17,.1,.52,white);poly([[.39,.69],[.61,.69],[.5,.9]],hi);rect(.14,.79,.72,.075,mid);break;
      case 'smelter':
        rect(.63,.08,.13,.29,mid);metal();oval(.5,.51,.24,.28,hi);oval(.5,.51,.17,.21,dark);
        poly([[.38,.64],[.4,.44],[.48,.53],[.58,.32],[.66,.64]],'#e99d58');break;
      case 'assembler':metal();gear();break;
      case 'damper':case 'm_damp':
        rect(.1,.8,.8,.07,mid);oval(.5,.44,.37,.34,hi);oval(.5,.44,.27,.24,dark);
        line(.16,.44,.84,.44,white);rect(.46,.15,.08,.65,mid);break;
      case 'belt':
        rect(.08,.29,.84,.44,dark);line(.08,.28,.92,.28,mid);line(.08,.74,.92,.74,mid);
        for(let i=0;i<3;i++){line(.2+i*.24,.38,.32+i*.24,.51,hi);line(.32+i*.24,.51,.2+i*.24,.64,hi);}break;
      case 'splitter':
        line(.5,.86,.5,.5,hi,.12);line(.5,.5,.18,.22,hi,.12);line(.5,.5,.82,.22,hi,.12);
        poly([[.08,.17],[.35,.18],[.14,.39]],mid);poly([[.65,.18],[.92,.17],[.86,.39]],mid);break;
      case 'filter':
        metal();for(let i=0;i<3;i++)rect(.3+i*.17,.25,.06,.51,hi);
        rect(.14,.47,.72,.07,mid);break;
      case 'loader':
        rect(.1,.7,.8,.12,mid);line(.22,.7,.43,.24,hi,.1);line(.43,.24,.79,.41,hi,.1);
        line(.79,.41,.69,.62,mid,.08);line(.79,.41,.91,.61,mid,.08);oval(.43,.24,.08,.08,white);break;
      case 'tunnel':
        oval(.5,.49,.39,.37,hi);rect(.11,.48,.78,.4,mid);oval(.5,.49,.25,.23,dark);rect(.25,.48,.5,.4,dark);
        line(.25,.81,.5,.63,hi);line(.5,.63,.75,.81,hi);break;
      case 'crusher':
        metal();poly([[.15,.1],[.85,.1],[.68,.4],[.32,.4]],hi);
        oval(.35,.57,.17,.21,mid);oval(.65,.57,.17,.21,mid);
        for(let i=0;i<3;i++){line(.22,.47+i*.09,.46,.47+i*.09,white,.035);line(.55,.47+i*.09,.78,.47+i*.09,white,.035);}break;
      case 'm_stock':
        metal();line(.16,.25,.83,.76,hi);line(.83,.25,.16,.76,hi);rect(.43,.42,.14,.19,white);break;
      case 'm_hull':
        poly([[.15,.17],[.5,.07],[.85,.17],[.79,.61],[.5,.93],[.21,.61]],hi);
        poly([[.5,.14],[.78,.23],[.71,.57],[.5,.81]],mid);break;
      case 'm_scan':
        oval(.5,.5,.39,.39,mid);oval(.5,.5,.3,.3,dark);oval(.5,.5,.16,.16,mid);oval(.5,.5,.1,.1,dark);
        line(.5,.5,.77,.24,hi);oval(.38,.35,.04,.04,white);break;
      case 'm_salv':
        line(.27,.13,.75,.13,hi,.08);line(.69,.13,.69,.54,mid,.09);
        oval(.58,.65,.2,.2,hi);oval(.58,.6,.12,.14,dark);rect(.3,.4,.22,.23,'#0b0c0c');break;
      case 'm_schem':
        rect(.17,.12,.66,.76,mid);rect(.24,.19,.52,.62,dark);
        for(let i=0;i<3;i++)line(.31,.33+i*.18,.68,.33+i*.18,hi);line(.42,.24,.42,.76,hi);break;
      case 'demolish':case 'm_fix':
        line(.25,.86,.67,.3,hi,.13);
        if(id==='demolish'){poly([[.1,.2],[.49,.13],[.91,.44],[.62,.33],[.35,.27]],mid);}
        else {poly([[.54,.32],[.58,.1],[.68,.29],[.8,.29],[.82,.09],[.95,.28],[.83,.46],[.63,.45]],mid);}break;
      default:metal();
    }
  }
  function paint(c,tiles,cw,ch) {
    // Independent tiles make fog, excavation, quakes and hidden neighbours
    // unambiguous. Detail is quiet; resource identities and fault marks win.
    for(const t of tiles) {
      const {rect,line,poly,oval}=pen(c,t.x*cw,t.y*ch,cw,ch);
      const rock=t.color, v=t.variant||0;
      rect(0,0,1,1,'#0c100f');
      if(t.kind==='rock'||t.kind==='obsidian') {
        rect(.025,.02,.95,.96,tone(rock,.33));
        poly([[.02,.05],[.65,.02],[.9,.31],[.28,.6],[.02,.48]],tone(rock,.46));
        poly([[.28,.6],[.9,.31],[.98,.98],[.18,.94]],tone(rock,.25));
        if(t.kind==='obsidian'){line(.2,.88,.78,.13,tone(rock,.76),.035);line(.24,.66,.94,.46,tone(rock,.48),.025);}
        else for(let i=0;i<3;i++)line(.08,.2+i*.24+(v*.035),.86,.13+i*.26,tone(rock,.55),.025);
        if(t.edge&1)rect(0,0,1,.038,tone(rock,.95));
        if(t.edge&2)rect(0,0,.055,1,tone(rock,.7));
        if(t.edge&4)rect(0,.96,1,.04,'#060807');
        if(t.edge&8)rect(.95,0,.05,1,'#060807');
      }else if(t.kind==='magma'){
        rect(0,0,1,1,'#35170e');
        poly([[0,.65],[.38,.46],[.62,.53],[1,.26],[1,.79],[.59,.92],[.3,.71],[0,.87]],'#743319');
        line(0,.65,.38,.46,'#a75523',.05);line(.62,.53,1,.26,'#ce7031',.06);
      }else if(t.kind==='chasm'){
        rect(0,0,1,1,'#040708');line(.08,.14,.19,.69,'#1a2427',.04);
      }else{
        rect(0,0,1,1,tone(rock,.19));
        rect(.13,.28+v*.17,.07,.035,tone(rock,.47));
      }
      if(t.ore) {
        const ore=tone(t.oreColor,.58);
        if(t.ore==='coal') {
          // Ragged carbon seam; leave the central spade glyph unobstructed.
          poly([[.03,.12],[.36,.06],[.3,.29],[.12,.35],[.04,.27]],tone(t.oreColor,.22));
          poly([[.59,.76],[.74,.68],[.96,.77],[.84,.95],[.63,.91]],tone(t.oreColor,.24));
          line(.04,.13,.35,.07,ore,.045);line(.65,.92,.85,.96,ore,.045);
          line(.08,.19,.2,.25,tone(t.oreColor,.43),.025);
        }else if(t.ore==='ironOre') {
          line(.07,.12,.44,.12,ore,.065);line(.12,.2,.4,.2,ore,.045);
          line(.6,.83,.95,.83,ore,.065);line(.55,.92,.89,.92,ore,.045);
        }else{
          poly([[.12,.2],[.29,.1],[.39,.23],[.23,.34]],ore);
          poly([[.64,.71],[.78,.62],[.88,.77],[.69,.87]],ore);
          line(.1,.94,.9,.94,tone(t.oreColor,.65),.055);
        }
      }
      if(t.belt!=null) {
        const horizontal=t.belt%2===1;
        rect(.06,.08,.88,.84,'#162127');
        if(horizontal){line(0,.16,1,.16,'#4f7075');line(0,.84,1,.84,'#4f7075');}
        else{line(.12,0,.12,1,'#4f7075');line(.88,0,.88,1,'#4f7075');}
      }
      if(t.machine) {
        rect(0,0,1,1,tone(t.machineColor,.2));
        rect(.09,.12,.82,.76,tone(t.machineColor,.3));
        const edge=t.machineEdge,stroke=tone(t.machineColor,.75);
        if(edge&1)line(.02,.04,.98,.04,stroke,.08);
        if(edge&2)line(.03,.04,.03,.98,stroke,.08);
        if(edge&4)line(.02,.96,.98,.96,tone(stroke,.6),.08);
        if(edge&8)line(.96,.04,.96,.98,tone(stroke,.6),.08);
        if(t.body) {
          icon(c,t.machine,t.x*cw+.1*cw,t.y*ch+.15*ch,.8*cw,.7*ch,tone(t.machineColor,.68));
        }
        if(t.active)rect(.16,.88,.15+t.phase*.2,.055,'#82c8ba');
      }
    }
  }
  DC.Strata={paint,icon,ICONS};
})();
