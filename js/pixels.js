/* Bedrock's authored pixel clusters. Rows encode palette indices, not text
   displayed in the game. No fonts, clocks, DOM or simulation access. */
(function () {
  'use strict';
  const root = typeof window !== 'undefined' ? window : globalThis;
  const DC = root.DC = root.DC || {};
  const PAL = {
    x:'#171d29', c:'#282d3b', d:'#454d5e', k:'#737c87',
    s:'#3c575c', t:'#568b86', u:'#9ac4ae', h:'#f2deb2',
    g:'#cd923e', y:'#f4c96b', r:'#8e493e', o:'#d47d4c',
    v:'#826593', l:'#c5a2ce', b:'#7cacc4', w:'#e7e7cf', f:'#ed9d4e'
  };
  const ART = {
    ironOre: [
      '................','................','.......xxxx.....','....xxxbbbkx....',
      '...xbbwwwbkdx...','..xbbwwbbbkddx..','.xbbbkkbbkkddx..','.xbbkkbbbkkdddx.',
      '.xkkbbbbkkdddx..','..xkbbkkkdddx...','...xkkkkdddx....','....xkddddx.....',
      '.....xxxxx......','................','................','................'],
    coal: [
      '................','........xx......','......xxddx.....','.....xdcddcx....',
      '..xxxddccccx....','.xdkkxcccxccx...','.xkdccxccxcccxx.','xdcccccxddxkddcx',
      'xdccccxxdcckcccx','xdcccxxddcccccxx','.xccxxdcccccccx.',
      '..xxxddccccccx..','....xdccccccx...','.....xxxxxxx....','................','................'],
    copperOre: [
      '................','................','...xxx..........','..xhyox...xxx...',
      '.xhyyoox.xyoox..','.xyooooxxhyoorx.','xyoorooxxyooorrx','xooorroxoooorrxx',
      '.xoorrxxyorrxx..','..xrrx.xorrxx...','...xx...xxx.....','................',
      '................','................','................','................'],
    crystal: [
      '.......x........','......xwx.......','.....xwllx......','.....xwllvx.....',
      '.....xwllvx..x..','..x..xwllvx.xlx.','.xlx.xwllvx.xlvx',
      '.xllxxlllvxxwlvx','.xllvxlllvxwllvx','..xlvxllvvxllvx.',
      '..xlvxllvvxllvx.','...xvxlvvvxvvx..','...xvxvvvxvvx...',
      '....xxvvxvvx....','......xxxxx.....','................'],
    ironPlate: [
      '................','................','................','......xxxxxx....',
      '...xxxwwwwwkx...','.xxwwwbbbkkkdx..','xwwbbbkkkkdddxx.',
      'xbkkkkddddddxx..','xxddddddxxxxbbx.','.xxxxxxxbbkkkkdx',
      '...xbbkkkkdddxx.','....xkdddxxxx...','.....xxxx.......','................',
      '................','................'],
    copperPlate: [
      '................','................','................','......xxxxxx....',
      '...xxxhhyyyox...','.xxhyyyyooorrx..','xhyyoooooorrrxx.',
      'xoooooorrrrrxx..','xxrrrrrrxxxxoox.','.xxxxxxxyoooorxx',
      '...xyoooorrrxx..','....xoorxxxx....','.....xxxx.......','................',
      '................','................'],
    gear: [
      '......xxxx......','......xyyx......','..xx..xygx..xx..','.xyyxxxygxxxyyx.',
      '.xyyyyyyygggggx.','..xyyggggggrrx..','xxxyggxxxxggrxxx',
      'xyyyggxccxggrrrx','xyygggxccxggrrrx','xxxyggxxxxggrxxx',
      '..xygggggggrrx..','.xyyggggggrrrrx.','.xygxxxggxxxrrx.',
      '..xx..xggx..xx..','......xggx......','......xxxx......'],
    charge: [
      '......xxxx......','......xhhx......','.....xgwwgx.....','....xxxxxxx.....',
      '....xwllvvx.....','....xwlwvvx.....','....xwllwvx.....','....xwllwvx.....',
      '....xwlwwvx.....','....xlwwvvx.....','....xllwvvx.....','....xllvvvx.....',
      '....xwkkddx.....','....xkkdddx.....','.....xxxxx......','................'],
    belt: [
      '................','xxxxxxxxxxxxxxxx','xkkkkkkkkkkkkkkx','xbddddddddddddbx',
      'xbcscccscccsccbx','xbcssccssccsscbx','xbctssctssctssbx','xbcttscttscttsbx',
      'xbctssctssctssbx','xbcssccssccsscbx','xbcscccscccsccbx','xbddddddddddddbx',
      'xkkkkkkkkkkkkkkx','xxxxxxxxxxxxxxxx','................','................'],
    extractor: [
      '........................','..........xxxx..........','.........xyhygx.........',
      '......xxxxggggxxxx......','.....xyyyyyyyyygggx.....','.....xyxgggggggxggx.....',
      '.....xggxxxxxxxgggx.....','......xxsbwbksxxkx......','......xssbwbkssxkx......',
      '......xtxbwbkxuxkx......','......xtxbwbkxuxkx......','.....xxtxxwbxxuxkxx.....',
      '....xootxxwbxxutkoox....','....xootxxwbxxutkoox....','....xrxtxxwbxxutxrrx....',
      '....xxxxtxwbxuxxxxxx....','.....xxxtxwbxuxxx.......','.....xrrrxwbxrrrx.......',
      '.....xxxxxwbxxxxx.......','.........xwwbx..........','.........xwbdx..........',
      '..........xbdx..........','...........xx...........','........................'],
    smelter: [
      '........................','..............xxx.......','.............xkkdx......',
      '.............xwkdx......','.............xwkdx......','......xxxxxxxkkkdx......',
      '.....xhhhyyyyxxxkx......','....xyooooooggxxkx......','...xyoorrrrroogxxx......',
      '..xyoorrrrrrroggox......','..xoorrrrrrrrroorx......','..xoorxxxxxxxxorrx......',
      '..xooxxxxxxxxxxrrx......','..xooxcfhfffcxxrrx......','..xooxfhhhffcxrrrx......',
      '..xooxfhhyffcxrrrx......','..xooxfffffccxrrrx......','..xooxxxxxxxxrrrrx......',
      '..xoooggggggrrrrrx......','..xxxkkddddkkkkxxx......','...xkdddddddddddx.......',
      '...xxxddxxxxxddxx.......','.....xxx....xxxx........','........................'],
    assembler: [
      '........................','.......xx...............','......xhhx..............',
      '......xggx..xxxx........','.....xxttxxxbbbkx.......','....xuuuuttwwbbkx.......',
      '...xuuuuttwwbbbkdx......','...xuttxtxxbbbkkdx......','...xuttxxxyyxxxxdx......',
      '...xuttxxyyyyxxxdx......','...xtttxyyxxyyxxdx......','...xtttxyyxxyyxxdx......',
      '...xtttxxyyyggxxdx......','...xtttxxxgggxxxkx......','...xtttxxxxxxxxxkx......',
      '...xttttsssssssskx......','...xuttwtssswttskx......','...xttttttttttsskx......',
      '...xkkkkkkkkkkkkkx......','...xxdddddddddddxx......','....xxddxxxxxddxx.......',
      '.....xxx.....xxx........','........................','........................'],
    damper: [
      '........................','.........xxxxxx.........','........xwwwwkkx........',
      '.......xwwkkkdddx.......','........xxddkkxx........','.........xttttx.........',
      '........xtuuuttx........','........xttuuutx........','........xttttuux........',
      '........xttuuutx........','........xtuuuttx........','........xttttuux........',
      '........xttuuutx........','........xtuuuttx........','........xttttuux........',
      '........xttuuutx........','.......xxuuuutxxx.......','......xwwwwwwkkddx......',
      '......xkkkkkkkdddx......','.......xxddddddxx.......','.........xxxxxx.........',
      '........................','........................','........................'],
    splitter: [
      '........................','...............xxx......','..............xhhgx.....',
      '.........xxxxxygggx.....','........xtttxxggxx......','...xxxxxttttssxx........',
      '..xwwwwtttttssssx.......','..xbddxxxttssxssx.......','..xbddx..xtssxssx.......',
      '..xbddx..xysxxssx.......','..xbddx..xygxxssx.......','..xbddx..xtssxssx.......',
      '..xbddx..xtssxssx.......','..xbddxxxttssxssx.......','..xkkkktttttssssx.......',
      '...xxxxxttttssxx........','........xtttxxggxx......','.........xxxxxygggx.....',
      '..............xgggx.....','...............xxx......','........................',
      '........................','........................','........................'],
    tunnel: [
      '........................','........................','........xxxxxxx.........',
      '......xxbbbbbbbxx.......','.....xbbwwwwbbbddx......','....xbbwwbbbkkkdddx.....',
      '...xbbwwbbbkkkkddddx....','...xbwbbxxxxxxxdddx.....','...xbwbxxcccccxxddx.....',
      '...xbwbxcccccccxdx......','...xbwbxcccccccxdx......','...xbwbxcccccccxdx......',
      '...xbwbxcccccccxdx......','...xbwbxcccccccxdx......','...xbwbxcccccccxdx......',
      '...xbwbxdddddddxdx......','...xbbbxkykykykxdx......','...xkkkkkkkkkkkddx......',
      '....xxxxxxxxxxxxx.......','........................','........................','........................',
      '........................','........................'],
    loader: [
      '........................','............xxxxx.......','...........xwkkkdx......',
      '...........xwkxkdx......','...........xwkxkdx......','.........xxxwkxxx.......',
      '........xyyywkx.........','.......xyyyyxxx.........','......xyyggxx...........',
      '.....xyyggx.............','....xyyggx..............','....xyggx...............',
      '....xgggx...............','.....xggx...............','......xggxx.............',
      '.......xyygxxx..........','......xttyyggtx.........','.....xtuuttgtttx........',
      '.....xtutttttttx........','.....xkkkkkkdddx........','......xxxxxxxxx.........',
      '........................','........................','........................'],
    crusher: [
      '........................','........................','....xxxxxxxxxxxxxxx.....',
      '...xwuuuuuuuuuuuuukx....','...xutxxxxxxxxxxxtkx....','...xutxcccxcccxcxtkx....',
      '....xuxccxdddxccxkx.....','....xuxcxxddxxccxkx.....','.....xuxgyxkkycxkx......',
      '.....xuxggxyyycxkx......','......xuxgxkkyxxkx......','......xuxxxxxxuxx.......',
      '.......xuuttssxx........','.......xuttsssx.........','......xxuttsssxx........',
      '.....xuttttttsssx.......','.....xuttxxxttssx.......','.....xuttxcxttssx.......',
      '.....xkkkkkkkdddx.......','......xxxxxxxxxx........','........................',
      '........................','........................','........................'],
    filter: [
      '........................','..............xxxx......','.............xwllvx.....',
      '.............xllvvx.....','..............xxxx......','......xxxxxxxxxxxxx.....',
      '.....xwwwwwwwwwwkkkx....','.....xtttktttktttssx....','.....xtttktttktttssx....',
      '.....xtctkcttkcccssx....','.....xtctkcttkcccssx....','.....xtttktttktttssx....',
      '.....xtttktttktttssx....','.....xtctkcttkcccssx....','.....xtctkcttkcccssx....',
      '.....xtttktttktttssx....','.....xtttktttktttssx....','.....xkkkkkkkkkkdddx....',
      '......xxxxxxxxxxxxx.....','........................','........................','........................',
      '........................','........................'],
    rig: [
      '................................','.......xxxx.....................','......xyyygx....................',
      '.....xyyggggx...................','.....xygxxggx...................','.....xygxxygx...................',
      '.....xygxxygx...................','.....xygxxygx...................','....xxwgxxygx...................',
      '...xkkwgxxygx...................','...xwkwgxxygx...................','...xwkwgxxygx...................',
      '...xxwkgxxygx...................','..xrrrrrxxygx...................','..xooorryxygx.......xxx.........',
      '...xwkkxxyygx......xhgx.........','...xkkkxxyygx...xxxxtttxxx......','..xwwkkxxyygx..xtuuuuutttx......',
      '..xkkkxxxyygx.xtthhhhhxttsx.....','...xwwkxxyygx.xtthyyhhxttssx....','..xkkkxxxyygx.xtthyhhgxttssx.xxx',
      '.xwwkkxxxyygx.xtthyhgxxttssx.xrx','..xkkkxxxyygx.xtthygxxtttssxxorx',
      '.xwwkkxxxyygx.xttxxxxxttssxooorx','..xkkkxxxyygx.xttttttxttssxorrxx',
      '.xwwkkxxxyygxxxttxttxtttssxorrxx','..xkkkxxxyygggggtttttttttssgggx',
      '..xwkkxxxyggggggggggggggggggrrx','...xkkx..xxxxxxxxxxxxxxxxxxxxxx.',
      '....xx...xddkdkkdkkdkkdkkdkddx..','.........xdkxdkxdkxdkxdkxdkddx..',
      '..........xxxxxxxxxxxxxxxxxx....'],
    bit: [
      '.....xxxxxx.....','.....xwwkkx.....','.....xwkkdx.....','.....xxxxxx.....',
      '....xwwwkkdx....','...xwwkkdddx....','....xkddxxx.....','...xwwxxkkdx....',
      '..xwwkkdddddx...','...xkdddxxx.....','...xwwxxkkdx....','..xwwkkdddddx...',
      '...xkdddxxx.....','....xwkkdx......','.....xkdx.......','......xx........'],
    crate: [
      '................','.....xxxxxx.....','...xxhhyyyoxx...','..xhyooooorrox..',
      '.xhhxxxxxxxrorx.','.xyyxgggggrxrrx.','.xyyxgggggrxrrx.','.xyyxghhggrxrrx.',
      '.xyyxghyggrxrrx.','.xyyxgygggrxrrx.','.xyyxgggggrxrrx.','.xyyxgggggrxrrx.',
      '.xyyxxxxxxxrrrx.','..xoooooooorxx..','...xxxxxxxxx....','................'],
    book: [
      '................','....xxxxxxxxx...','..xxwwwwwwwkkx..','.xttxxxxxxxxkx..',
      '.xttbtttttssxkx.','.xttwwwwttssxkx.','.xttwbbwtsssxkx.','.xttwbbwtsssxkx.',
      '.xttwwwwtsssxkx.','.xtttttttsssxkx.','.xtthhhttsssxkx.','.xtttttttsssxkx.',
      '.xtttttttsssxx..','..xtttttttssx...','...xxxxxxxxx....','................'],
    repair: [
      '................','.........xx.xx..','........xwkxwkx.','.......xwkx.xkx.',
      '.......xwkx.xkx.','.......xwkkxkkx.','........xwkkkx..','.......xwkkkx...',
      '......xwkkxx....','.....xwkkx......','....xwkkx.......','...xwkkx........',
      '..xwwkx.........','..xwxkx.........','...xxx..........','................'],
    radar: [
      '............xx..','...........xhyx.','..xx......xgxx..','..xwx....xkx....',
      '..xwwx..xkx.....','..xwbwxkx.......','...xbwwx........','...xbbbwx.......',
      '....xbbkkx......','.....xkkkx......','......xkx.......','......xkx.......',
      '.....xttsx......','....xtttssx.....','...xxxxxxxxx....','................'],
    claw: [
      '......xxxx......','......xwkx......','......xwkx......','......xwkx......',
      '.....xyyygx.....','....xyhyyggx....','....xyyygggx....','...xwwxxxxkkx...',
      '..xwwx....xkkx..','.xwwx......xkkx.','.xwkx......xkkx.',
      '.xwkx.x..x.xkkx.','..xwkxx..xxkkx..','...xwkx..xkkx...',
      '....xx....xx....','................'],
    trophy: [
      '................','...xxxxxxxxxx...','..xyxwwyyyxggx..','.xyxxyyyyyxxggx.',
      '.xyxxyyyyyxxggx.','.xyxxyyyggxxggx.','..xyxxyggxxggx..','...xyyxggxggx...',
      '....xxxygxxx....','......xygx......','......xygx......','.....xyyygx.....',
      '....xxxxxxx.....','...xkddddddx....','...xxxxxxxxx....','................'],
    grit: [
      '................','.....xxxxxx.....','....xyyyyygx....','...xyyhhyyyxx...',
      '..xxgggggggggx..','..xhhhwwwwhhhx..','...xoooxoooox...','...xocccoccx....',
      '...xooohoox.....','....xoorrx......','....xxhhxx......','..xxtxrrxtxx....',
      '.xtutxxxxuttx...','xtuttxygxtttsx..','xtuttxygxtttsx..','.xxxxxxxxxxxx...'],
    seal: [
      '................','.....xxxxxx.....','...xxhyyyygxx...','..xhyyyyyggggx..',
      '..xyyyyxxxgggx..','.xhyyyxtxtxgggx.','.xyyyxtttxtxggx.','.xyyyxtytttxggx.',
      '.xyyyyxtttxgggx.','.xyyyyyxxxggggx.','..xyyyyyyggggx..','..xgggggggggrx..',
      '...xxggggrrxx...','.....xxxxxx.....','................','................'],
    shield: [
      '................','..xxxxxxxxxxxx..','..xhyyyyyygggx..','..xyyyyyggggrx..',
      '..xyyyyyggggrx..','..xyyyxggxggrx..','...xyyxxgxgrx...','...xyyxgxggrx...',
      '...xyyyxggrrx...','....xyygggrx....','....xygggrrx....','.....xyggrx.....',
      '......xgrx......','.......xx.......','................','................'],
    skull: [
      '................','.....xxxxxx.....','...xxwwwwhhxx...','..xwwwwhhhhkkx..',
      '..xwwwwhhhhkkx..','.xwwwwhhhhkkkdx.','.xwwxxhhxxkkkdx.','.xwxccxxccxkkdx.',
      '.xwxccxxccxkkdx.','..xwxxhhxxkkdx..','...xhhxxhkkkx...','....xhkxhkxx....',
      '....xhxhxhx.....','.....xxxxx......','................','................']
  };
  // Small mechanical additions communicate all nine permanent upgrades.
  function paint(id,p,o) {
    o=o||{};
    if(id==='hub')id='rig';
    const rows=ART[id];
    if(!rows)return false;
    const width=Math.max(...rows.map(r=>r.length)),height=rows.length;
    const size=Math.max(width,height),ox=(size-width)/2,oy=(size-height)/2;
    const palette=Object.assign({},PAL);
    if(o.accent)palette.y=o.accent;
    if(id==='smelter'&&!o.active){palette.f=PAL.c;palette.h=PAL.d;}
    if(id==='damper'&&!o.active)palette.u=PAL.k;
    for(let y=0;y<height;y++)for(let x=0;x<rows[y].length;x++) {
      const char=rows[y][x],color=palette[char];
      if(color)p.rect((x+ox)*100/size,(y+oy)*100/size,100/size,100/size,color);
    }
    const q=(x,y,w,h,color)=>p.rect(x*100/size,y*100/size,w*100/size,h*100/size,color);
    const active=!!o.active,phase=active?(o.phase||0)%3:0;
    if(active) {
      if(id==='extractor')q(10,13+phase,2,3,PAL.w);
      if(id==='smelter')q(8+phase,14-phase,2,2,PAL.y);
      if(id==='assembler')q(12+phase,10,1,2,PAL.w);
      if(id==='damper')q(10,7+phase*3,3,1,PAL.h);
      if(id==='rig'){q(27,13-phase,2,1,PAL.k);q(30,10-phase,1,2,PAL.d);}
      if(id==='loader')q(11+phase,3,1,3,PAL.w);
      if(id==='crusher')q(12+phase,9,1,2,PAL.w);
    }
    if(id==='rig') {
      const u=o.upgrades||{};
      if(u.m_stock){q(25,22,5,4,PAL.g);q(27,22,1,4,PAL.h);}
      if(u.m_hull){q(15,26,10,2,PAL.k);q(16,26,1,1,PAL.w);}
      if(u.m_damp){q(10,28,1,4,PAL.t);q(26,28,1,4,PAL.t);}
      if(u.m_torque){q(3,10,4,2,PAL.y);q(3,14,4,1,PAL.g);}
      if(u.m_fix){q(23,23,3,3,PAL.h);q(24,23,1,3,PAL.r);q(23,24,3,1,PAL.r);}
      if(u.m_scan){q(20,11,1,5,PAL.k);q(17,11,6,1,PAL.b);q(18,12,4,1,PAL.b);}
      if(u.m_salv){q(29,19,1,6,PAL.k);q(28,24,2,1,PAL.w);}
      if(u.m_deep){q(26,20,1,3,PAL.l);q(28,20,1,3,PAL.v);}
      if(u.m_schem){q(15,22,3,3,PAL.b);q(16,22,1,2,PAL.w);}
    }
    return true;
  }
  // A discrete pen for the rarer authored objects (landmarks and trophies).
  // All output is opaque palette pixels; curves never acquire a smooth SVG
  // outline beside the hand-clustered production sprites.
  function rasterPen(size) {
    const cells=new Array(size*size).fill(null), scale=size/100;
    const dot=(x,y,c)=>{if(c&&x>=0&&y>=0&&x<size&&y<size)cells[y*size+x]=c;};
    const scan=(x0,y0,x1,y1,fn,c)=>{
      for(let y=Math.max(0,Math.floor(y0));y<Math.min(size,Math.ceil(y1));y++)
        for(let x=Math.max(0,Math.floor(x0));x<Math.min(size,Math.ceil(x1));x++)if(fn(x+.5,y+.5))dot(x,y,c);
    };
    const pen={
      rect(x,y,w,h,c){
        const x0=Math.round(x*scale),y0=Math.round(y*scale),x1=Math.round((x+w)*scale),y1=Math.round((y+h)*scale);
        scan(x0,y0,x1,y1,()=>true,c);
      },
      line(points,c,width){
        const radius=Math.max(.55,(width||1)*scale/2);
        for(let i=1;i<points.length;i++){
          const ax=points[i-1][0]*scale,ay=points[i-1][1]*scale,bx=points[i][0]*scale,by=points[i][1]*scale;
          const dx=bx-ax,dy=by-ay,den=dx*dx+dy*dy;
          scan(Math.min(ax,bx)-radius,Math.min(ay,by)-radius,Math.max(ax,bx)+radius,Math.max(ay,by)+radius,(x,y)=>{
            const t=den?Math.max(0,Math.min(1,((x-ax)*dx+(y-ay)*dy)/den)):0;
            return (x-ax-dx*t)**2+(y-ay-dy*t)**2<=radius*radius;
          },c);
        }
      },
      poly(points,c,stroke,width){
        const pts=points.map(([x,y])=>[x*scale,y*scale]);
        if(c)scan(Math.min(...pts.map(p=>p[0])),Math.min(...pts.map(p=>p[1])),Math.max(...pts.map(p=>p[0])),Math.max(...pts.map(p=>p[1])),(x,y)=>{
          let inside=false;
          for(let i=0,j=pts.length-1;i<pts.length;j=i++){
            const a=pts[i],b=pts[j];
            if((a[1]>y)!==(b[1]>y)&&x<(b[0]-a[0])*(y-a[1])/(b[1]-a[1])+a[0])inside=!inside;
          }
          return inside;
        },c);
        if(stroke)pen.line(points.concat([points[0]]),stroke,width);
      },
      oval(x,y,rx,ry,c,stroke,width){
        x*=scale;y*=scale;rx*=scale;ry*=scale;
        if(c)scan(x-rx,y-ry,x+rx,y+ry,(a,b)=>((a-x)/rx)**2+((b-y)/ry)**2<=1,c);
        if(stroke){
          const d=Math.max(.55,(width||1)*scale/2);
          scan(x-rx-d,y-ry-d,x+rx+d,y+ry+d,(a,b)=>((a-x)/(rx+d))**2+((b-y)/(ry+d))**2<=1&&((a-x)/Math.max(.1,rx-d))**2+((b-y)/Math.max(.1,ry-d))**2>=1,stroke);
        }
      },
      flush(target){
        for(let y=0;y<size;y++)for(let x=0;x<size;x++){
          const c=cells[y*size+x];if(!c)continue;
          let end=x+1;while(end<size&&cells[y*size+end]===c)end++;
          target.rect(x/scale,y/scale,(end-x)/scale,1/scale,c);x=end-1;
        }
      },cells,size
    };
    return pen;
  }
  DC.Pixels={PAL,ART,paint,rasterPen};
}());
