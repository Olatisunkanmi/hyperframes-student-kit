// Per-video graphics for IMG 8410 (EMR translation). The reusable pipeline lives in scripts/build-video.mjs;
// this file is the only part that is specific to what this video says. Interface: see scripts/lib/builder/compose.mjs.
// Overlay clips use data-track-index >= 20 (the core uses 0, 1, 3, 8, 10-13).
export default function beats({ find, H, HB, r, C }) {
  const A = {};
  A.hook37 = find("thirty-seven", 0, "hook"); A.hookEMR = find("emr", 0, "hook"); A.hookMis = find("mistranslated", 0, "hook");
  A.healthcare = find("healthcare", HB); A.five = find("five", HB); A.years = find("years", HB);
  A.translation = find("translation", HB); A.patients1 = find("patients'", A.translation.start);
  A.from = find("from", A.patients1.start); A.other1 = find("other", A.from.start);
  A.t37 = find("thirty-seven", A.other1.start, "body"); A.percent = find("percent", A.t37.start); A.emr2 = find("emr", A.percent.start);
  A.mis = find("mistranslated", A.t37.start, "body"); A.unable = find("unable", A.mis.start); A.translated = find("translated", A.unable.start);
  A.when = find("when", A.translated.start); A.diff1 = find("different", A.when.start); A.systems = find("systems", A.diff1.start);
  A.diff2 = find("different", A.systems.start); A.coding = find("coding", A.diff2.start); A.system2 = find("system", A.coding.start);

  // Every count-up is declared here ONCE: it drives the GSAP tween and the counter sound cues.
  const counters = [
    { id: "hnum", from: 0, to: 37, start: Math.max(0.05, A.hook37.start), duration: 0.78, ease: "power2.out", suffix: "%", land: "hit", landGain: -9, gain: -12, why: "hook: 37% counts up" },
    { id: "ynum", from: 0, to: 5, start: A.five.start - 0.1, duration: +(A.five.end - A.five.start + 0.15).toFixed(2), ease: "power2.out", suffix: "", plusAtEnd: true, land: "ping", landGain: -8, gain: -11, why: "years counter" },
    { id: "snum", from: 0, to: 37, start: A.t37.start, duration: +(A.t37.end - A.t37.start + 0.1).toFixed(2), ease: "power2.out", suffix: "%", land: "ping", landGain: -8, gain: -12, why: "37% callback counts up" },
  ];

  const cues = [
    { t: A.healthcare.start - 0.1, sfx: "pop", gain: -12, why: "years panel enters" },
    { t: A.translation.start - 0.1, sfx: "pop", gain: -11, why: "transfer panel enters" },
    { t: A.other1.start, sfx: "tick", gain: -8, why: "record garbles on arrival" },
    { t: A.t37.start - 0.1, sfx: "pop", gain: -11, why: "37% callback panel enters" },
    { t: A.diff1.start - 0.1, sfx: "pop", gain: -11, why: "field comparison panel enters" },
    { t: A.diff2.start, sfx: "hit", gain: -15, why: "not-equal sign lands" },
  ];

  const css = `
/* hook + stat */
#hook .num,#stat .num{position:absolute;left:56px;top:30px;font-size:260px;line-height:1}
#hook .lab1{position:absolute;left:62px;top:310px;font-size:40px}
#hook .lab2{position:absolute;left:62px;top:356px;font-size:44px;color:var(--teal)}
#hook .bar{left:62px;top:404px;width:300px}
#stat .num{font-size:230px;top:34px}
#stat .grid{position:absolute;left:560px;top:48px;width:330px;height:330px;display:grid;grid-template-columns:repeat(10,1fr);gap:9px}
#stat .dot{border-radius:50%;background:#DCE3E9}
#stat .lab1{position:absolute;left:62px;top:290px;font-size:34px}
#stat .lab2{position:absolute;left:62px;top:336px;font-size:38px;color:var(--teal)}
#stat .bar{left:62px;top:392px;width:220px}
/* years */
#years .num{position:absolute;left:56px;top:62px;font-size:250px;line-height:1}
#years .yr{position:absolute;left:350px;top:140px;font-size:96px}
#years .lab1{position:absolute;left:60px;top:352px;font-size:34px}
#years svg{position:absolute;right:36px;top:70px;width:280px;height:140px}
#years .bar{left:60px;top:398px;width:220px}
/* transfer */
#xfer .sys{position:absolute;top:52px;width:250px;height:92px;border-radius:20px;border:3px solid var(--teal);color:var(--teal);font-size:44px;display:flex;align-items:center;justify-content:center;font-family:'Space Grotesk',sans-serif;font-weight:700}
#xfer .sA{left:50px}#xfer .sB{right:50px}
#xfer .line{position:absolute;left:300px;right:300px;top:97px;height:4px;background:#C9D3DB}
#xfer .card{position:absolute;left:60px;top:190px;width:300px;height:190px;border-radius:22px;background:var(--navy);color:#fff;padding:20px 22px}
#xfer .card .hd{font-weight:600;font-size:22px;letter-spacing:.1em;margin-bottom:12px;color:#fff}
#xfer .row{position:relative;height:36px;font-size:26px;font-weight:600}
#xfer .row span{position:absolute;left:0;top:0;white-space:nowrap}
#xfer .row .bad{color:var(--amber);opacity:0;font-family:'Space Grotesk',sans-serif;font-weight:700}
#xfer .cap{position:absolute;left:50px;top:350px;font-size:28px;white-space:nowrap;color:var(--slate)}
/* coding */
#code .box{position:absolute;top:48px;width:360px;height:300px;border-radius:24px;border:2px solid var(--line);background:#F4F7F9;padding:26px}
#code .bA{left:44px}#code .bB{right:44px}
#code .box .hd{font-size:26px;font-weight:600;letter-spacing:.12em;color:var(--teal);margin-bottom:22px}
#code .box .k{font-size:34px;font-weight:600;color:var(--navy);height:62px}
#code .neq{position:absolute;left:50%;top:140px;transform:translateX(-50%);font-size:110px;line-height:1}
#code .bar{left:50%;top:262px;width:70px;margin-left:-35px}
#code .note{position:absolute;left:0;right:0;bottom:22px;text-align:center;font-size:24px}`;

  const html = `
  <div id="hook" class="panel clip" data-start="0" data-duration="${H}" data-track-index="20">
    <div class="num disp" id="hnum">0%</div>
    <div class="lab1 disp">OF EMR RECORDS ARE</div>
    <div class="lab2 disp" id="hmis">MISTRANSLATED</div>
    <div class="bar" id="hbar"></div>
  </div>
  <div id="years" class="panel clip" data-start="${r(A.healthcare.start - 0.1)}" data-duration="${r(A.years.end + 0.5 - A.healthcare.start + 0.1)}" data-track-index="21">
    <div class="num disp" id="ynum">0</div>
    <div class="yr disp" id="yyr">years</div>
    <div class="lab1 lab">In healthcare software</div>
    <svg viewBox="0 0 340 170"><polyline id="ecg" fill="none" stroke="${C.teal}" stroke-width="6" stroke-linecap="round" stroke-linejoin="round" points="0,100 70,100 90,100 110,40 135,150 160,100 200,100 225,100 245,70 265,100 340,100"/></svg>
    <div class="bar" id="ybar"></div>
  </div>
  <div id="xfer" class="panel clip" data-start="${r(A.translation.start - 0.1)}" data-duration="${r(A.other1.end + 0.35 - A.translation.start + 0.1)}" data-track-index="22">
    <div class="sys sA" id="sA">EMR A</div><div class="sys sB" id="sB">EMR B</div>
    <div class="line" id="xline"></div>
    <div class="card" id="xcard"><div class="hd">PATIENT RECORD</div>
      <div class="row"><span class="ok">Name: A. Patient</span><span class="bad">N#m#: ??</span></div>
      <div class="row"><span class="ok">DOB: 04/12/1980</span><span class="bad">D#B: ##/##</span></div>
      <div class="row"><span class="ok">Dx: Type 2 diabetes</span><span class="bad">D#: ####</span></div></div>
    <div class="cap lab" id="xcap" style="opacity:0">Lost in translation</div>
  </div>
  <div id="stat" class="panel clip" data-start="${r(A.t37.start - 0.1)}" data-duration="${r(A.translated.end + 0.3 - A.t37.start + 0.1)}" data-track-index="23">
    <div class="num disp" id="snum">0%</div>
    <div class="grid" id="sgrid"></div>
    <div class="lab1 disp" id="sl1">OF EMR RECORDS ARE</div>
    <div class="lab2 disp" id="sl2">MISTRANSLATED</div>
    <div class="bar" id="sbar"></div>
  </div>
  <div id="code" class="panel clip" data-start="${r(A.diff1.start - 0.1)}" data-duration="${r(A.system2.end + 0.35 - A.diff1.start + 0.1)}" data-track-index="24" style="height:400px">
    <div class="box bA" id="bA"><div class="hd">SYSTEM A</div><div class="k">patient_name</div><div class="k">dob</div><div class="k">dx_code</div></div>
    <div class="box bB" id="bB"><div class="hd">SYSTEM B</div><div class="k">fullName</div><div class="k">birthDate</div><div class="k">diagnosis</div></div>
    <div class="neq disp" id="neq">≠</div><div class="bar" id="nbar"></div>
    <div class="note lab">Illustrative field names</div>
  </div>`;

  const js = `
var g=document.getElementById('sgrid');for(var i=0;i<100;i++){var d=document.createElement('div');d.className='dot';d.id='dot'+i;g.appendChild(d);}
// HOOK
tl.from('#hook',{opacity:0,y:-40,duration:.25,ease:'power3.out'},0.02);
tl.from('#hook .lab1',{opacity:0,x:-30,duration:.35,ease:'power2.out'},T('hookEMR')-0.15);
tl.from('#hmis',{opacity:0,x:-40,duration:.3,ease:'expo.out'},T('hookMis')-0.05);
tl.from('#hbar',{scaleX:0,duration:.5,ease:'power3.inOut'},T('hookMis'));
// YEARS
tl.from('#years',{opacity:0,y:-40,duration:.35,ease:'power3.out'},T('healthcare')-0.1);
var ecg=document.getElementById('ecg');var L=ecg.getTotalLength();ecg.style.strokeDasharray=L;
tl.fromTo('#ecg',{strokeDashoffset:L},{strokeDashoffset:0,duration:T('five')-T('healthcare'),ease:'none'},T('healthcare'));
tl.from('#yyr',{opacity:0,x:-30,duration:.3,ease:'power2.out'},T('years'));
tl.from('#ybar',{scaleX:0,duration:.4,ease:'power3.out'},T('years'));
tl.to('#years',{opacity:0,y:-30,duration:.25,ease:'power2.in'},T('years',1)+0.3);
// TRANSFER
tl.from('#xfer',{opacity:0,y:-40,duration:.35,ease:'power3.out'},T('translation')-0.1);
tl.from('#sA',{opacity:0,scale:.8,duration:.35,ease:'back.out(1.6)'},T('translation')+0.1);
tl.from('#sB',{opacity:0,scale:.8,duration:.35,ease:'back.out(1.6)'},T('translation')+0.3);
tl.from('#xline',{scaleX:0,duration:.6,ease:'power2.inOut'},T('translation')+0.4);
tl.from('#xcard',{opacity:0,y:30,duration:.4,ease:'power3.out'},T('patients1'));
tl.to('#xcard',{x:560,duration:T('other1')-T('from')+0.1,ease:'power2.inOut'},T('from'));
tl.to('#xcard .ok',{opacity:0,duration:.2,ease:'none'},T('other1'));
tl.to('#xcard .bad',{opacity:1,duration:.2,ease:'none'},T('other1'));
tl.to('#xcard',{rotation:-3,duration:.15,yoyo:true,repeat:1,ease:'power1.inOut',transformOrigin:'50% 50%'},T('other1'));
tl.to('#xcap',{opacity:1,duration:.3,ease:'power2.out'},T('other1',1)-0.1);
tl.to('#xfer',{opacity:0,y:-30,duration:.25,ease:'power2.in'},T('other1',1)+0.3);
// STAT callback
tl.from('#stat',{opacity:0,y:-40,duration:.3,ease:'power3.out'},T('t37')-0.1);
for(var i=0;i<37;i++){tl.to('#dot'+i,{backgroundColor:'${C.teal}',duration:.12,ease:'none'},T('percent')+i*0.012);}
tl.from('#sl1',{opacity:0,x:-30,duration:.3,ease:'power2.out'},T('emr2')-0.1);
tl.from('#sl2',{opacity:0,x:-40,duration:.3,ease:'expo.out'},T('mis')-0.05);
tl.from('#sbar',{scaleX:0,duration:.4,ease:'power3.out'},T('mis'));
tl.to('#sl2',{opacity:0,duration:.15,ease:'none'},T('unable')-0.12);
tl.set('#sl2',{textContent:'OR UNTRANSLATABLE'},T('unable')-0.05);
tl.to('#sl2',{opacity:1,duration:.2,ease:'power2.out'},T('unable')-0.04);
tl.to('#stat',{opacity:0,y:-30,duration:.25,ease:'power2.in'},T('translated',1)+0.15);
// CODING
tl.from('#code',{opacity:0,y:-40,duration:.35,ease:'power3.out'},T('diff1')-0.1);
tl.from('#bA',{opacity:0,x:-50,duration:.4,ease:'power3.out'},T('diff1'));
tl.from('#bB',{opacity:0,x:50,duration:.4,ease:'power3.out'},T('systems'));
tl.from('#neq',{opacity:0,scale:2.2,duration:.3,ease:'back.out(2)'},T('diff2'));
tl.from('#nbar',{scaleX:0,duration:.3,ease:'power3.out'},T('diff2')+0.1);
tl.fromTo('#bA .k,#bB .k',{color:'${C.navy}'},{color:'${C.teal}',duration:.25,stagger:.05,ease:'none'},T('coding'));
tl.to('#code',{opacity:0,y:-30,duration:.25,ease:'power2.in'},T('system2',1)+0.2);`;

  return { anchors: A, html, css, js, counters, cues };
}
