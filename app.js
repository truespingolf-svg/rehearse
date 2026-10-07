(() => {
  const state = {
    songs: JSON.parse(localStorage.getItem("rf_songs") || "[]"),
    currentSongId: null,
    setupPlayer: null,
    practicePlayer: null,
    playerReady: {setup:false, practice:false},
    analysisText: "",
    setupSections: [],
    audio: null,
    clickOn: false,
    loopOn: false,
    lastBeat: -1,
    tapTimes: [],
    raf: null
  };

  const $ = (id) => document.getElementById(id);
  const save = () => localStorage.setItem("rf_songs", JSON.stringify(state.songs));
  const toast = (m) => { const t=$("toast"); t.textContent=m; t.classList.add("show"); setTimeout(()=>t.classList.remove("show"),2200); };
  const fmt = s => { s=Math.max(0,Number(s)||0); const m=Math.floor(s/60), sec=Math.floor(s%60); return `${m}:${String(sec).padStart(2,"0")}`; };

  function extractVideoId(url) {
    try {
      const u=new URL(url);
      if(u.hostname.includes("youtu.be")) return u.pathname.slice(1).split("/")[0];
      if(u.searchParams.get("v")) return u.searchParams.get("v");
      const m=u.pathname.match(/\/(?:embed|shorts|live)\/([^/?]+)/); return m?.[1] || "";
    } catch { return ""; }
  }

  function openPage(name){
    document.querySelectorAll(".page").forEach(p=>p.classList.remove("active"));
    $(name+"Page").classList.add("active");
    document.querySelectorAll(".nav").forEach(n=>n.classList.toggle("active", n.dataset.page===name));
    const titles={library:["REHEARSAL LIBRARY","Your Songs"],setup:["SONG SETUP","Add a rehearsal song"],practice:["PRACTICE MODE","Practice"]};
    $("eyebrow").textContent=titles[name][0]; $("pageTitle").textContent=titles[name][1];
    if(name==="library") renderLibrary();
  }
  document.querySelectorAll(".nav").forEach(n=>n.onclick=()=>openPage(n.dataset.page));
  $("headerAdd").onclick=()=>openPage("setup"); $("emptyAdd").onclick=()=>openPage("setup");

  function renderLibrary(){
    const grid=$("songGrid"); grid.innerHTML="";
    $("libraryEmpty").style.display=state.songs.length?"none":"grid";
    state.songs.forEach(song=>{
      const node=document.importNode($("songCardTemplate").content,true);
      node.querySelector(".song-title").textContent=song.title;
      node.querySelector(".song-artist").textContent=song.artist || "Worship song";
      node.querySelector(".song-meta").textContent=`${song.bpm} BPM · ${song.sections?.length||0} sections · ${song.videoId?"YouTube":"No video"}`;
      node.querySelector(".open-song").onclick=()=>loadPractice(song.id);
      grid.appendChild(node);
    });
  }

  function makePlayer(target, onReady){
    return new YT.Player(target, {
      width:"100%", height:"100%", videoId:"", playerVars:{rel:0,modestbranding:1,playsinline:1,controls:1},
      events:{onReady:()=>onReady?.(), onStateChange:onStateChange, onError:e=>toast("YouTube player error: "+e.data)}
    });
  }
  window.onYouTubeIframeAPIReady=()=>{
    state.setupPlayer=makePlayer("setupPlayer",()=>state.playerReady.setup=true);
    // practice player is created lazily to keep the initial page light
    if(!$("practicePlayer").querySelector("iframe")) state.practicePlayer=makePlayer("practicePlayer",()=>state.playerReady.practice=true);
  };
  function onStateChange(e){
    if(e.data===YT.PlayerState.PLAYING){ $("playPauseBtn").textContent="❚❚"; startLoop(); }
    else if(e.data===YT.PlayerState.PAUSED || e.data===YT.PlayerState.ENDED){ $("playPauseBtn").textContent="▶"; if(e.data===YT.PlayerState.ENDED) stopAudio(); }
  }

  $("youtubeUrl").addEventListener("change",()=>{
    const id=extractVideoId($("youtubeUrl").value);
    if(id && state.playerReady.setup){state.setupPlayer.cueVideoById(id); $("setupVideoTitle").textContent="Video loaded";}
  });

  async function extractPdfText(file){
    if(!file) return "";
    try{
      const pdfjs = window.pdfjsLib || await import("https://cdnjs.cloudflare.com/ajax/libs/pdf.js/4.8.69/pdf.min.mjs");
      if(pdfjs.GlobalWorkerOptions) pdfjs.GlobalWorkerOptions.workerSrc="https://cdnjs.cloudflare.com/ajax/libs/pdf.js/4.8.69/pdf.worker.min.mjs";
      const ab=await file.arrayBuffer(), pdf=await pdfjs.getDocument({data:ab}).promise;
      let out="";
      for(let i=1;i<=pdf.numPages;i++){
        const page=await pdf.getPage(i), content=await page.getTextContent();
        out += content.items.map(x=>x.str).join(" ") + "\n";
      }
      return out;
    }catch(e){ throw new Error("Couldn't read the PDF in this browser."); }
  }

  const sectionRe=/\b(intro|verse|pre[\s-]?chorus|chorus|bridge|tag|turnaround|instrumental|interlude|break|vamp|outro|ending|refrain|hook)(?:\s*\d+)?\b/i;
  const chordRe=/\b[A-G](?:#|b)?(?:m|maj|min|sus|add|dim|aug|6|7|9|11|13|2|4|5)*(?:\/[A-G](?:#|b)?)?\b/g;
  function heuristicSections(text){
    const lines=text.split(/\n+/).map(s=>s.trim()).filter(Boolean);
    const sections=[]; let current=null;
    for(const line of lines){
      const m=line.match(sectionRe);
      const chords=(line.match(chordRe)||[]).slice(0,12);
      if(m){
        current={name: line.length<70?line.replace(/\s+/g," ").trim():m[0].toUpperCase(), chords:[], start:0, beatsPerChord:4};
        sections.push(current);
      } else if(chords.length){
        if(!current){ current={name:"Song",chords:[],start:0,beatsPerChord:4};sections.push(current); }
        current.chords.push(...chords);
      }
    }
    if(!sections.length){
      const chords=(text.match(chordRe)||[]).slice(0,80);
      sections.push({name:"Song",chords:chords.length?chords:["C","G","Am","F"],start:0,beatsPerChord:4});
    }
    return sections.map((s,i)=>({...s,name:s.name.replace(/^\d+[\).\s]+/,""),chords:[...new Set(s.chords)].slice(0,32),start:i?undefined:0}));
  }

  async function analyzeChart(){
    const file=$("pdfFile").files[0], url=$("youtubeUrl").value.trim();
    if(!url) return toast("Add a YouTube URL first.");
    if(!extractVideoId(url)) return toast("That YouTube URL doesn't look valid.");
    $("analysisStatus").textContent="Reading your chart…";
    try{
      state.analysisText=await extractPdfText(file);
      state.setupSections=heuristicSections(state.analysisText);
      const ai = await tryAiAnalyze(state.analysisText);
      if(ai?.sections?.length) state.setupSections=ai.sections;
      $("analysisStatus").innerHTML=`Detected <b>${state.setupSections.length}</b> sections and <b>${state.setupSections.reduce((a,s)=>a+(s.chords?.length||0),0)}</b> chart chords. Review the timeline below, then sync section starts precisely.`;
      renderSetupSections();
      const id=extractVideoId(url); if(state.playerReady.setup){state.setupPlayer.cueVideoById(id); $("setupVideoTitle").textContent="YouTube video loaded";}
    }catch(e){$("analysisStatus").textContent=e.message; state.setupSections=[]; renderSetupSections();}
  }

  async function tryAiAnalyze(text){
    if(!text) return null;
    try{
      const r=await fetch("/.netlify/functions/analyze",{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify({chartText:text})});
      if(!r.ok) return null;
      return await r.json();
    }catch{return null}
  }

  function renderSetupSections(){
    const box=$("sectionEditor");box.innerHTML="";
    state.setupSections.forEach((s,i)=>{
      const row=document.createElement("div"); row.className="section-row";
      row.innerHTML=`<span class="section-index">${String(i+1).padStart(2,"0")}</span>
        <input class="section-name" value="${escapeHtml(s.name)}">
        <input class="time-input" type="number" min="0" step="0.01" value="${Number.isFinite(s.start)?s.start.toFixed(2):"0.00"}">
        <button class="sync-here">Set here</button><span class="section-color">${s.chords?.slice(0,5).join(" · ")||"No chords detected"}</span>`;
      row.querySelector(".section-name").oninput=e=>s.name=e.target.value;
      row.querySelector(".time-input").oninput=e=>s.start=Number(e.target.value)||0;
      row.querySelector(".sync-here").onclick=()=>{
        if(state.setupPlayer && state.playerReady.setup){ s.start=Number(state.setupPlayer.getCurrentTime().toFixed(2)); row.querySelector(".time-input").value=s.start.toFixed(2); toast(`${s.name} synced at ${fmt(s.start)}`); }
      };
      box.appendChild(row);
    });
  }

  function autoPlace(){
    const dur=state.setupPlayer?.getDuration?.()||0;
    if(!dur){toast("Load a YouTube video first.");return;}
    const n=state.setupSections.length; if(!n)return;
    // Conservative estimate: section starts distributed with a longer intro/ending allowance.
    state.setupSections.forEach((s,i)=>s.start=Number((dur*(i/n)).toFixed(2)));
    renderSetupSections(); toast("Estimated timestamps added. Precision-sync them against the song.");
  }

  function escapeHtml(s){return String(s).replace(/[&<>"']/g,c=>({"&":"&amp;","<":"&lt;",">":"&gt;","\"":"&quot;","'":"&#39;"}[c]));}

  $("analyzeBtn").onclick=analyzeChart; $("autoPlaceBtn").onclick=autoPlace;

  $("saveSongBtn").onclick=()=>{
    const title=$("songTitle").value.trim()||"Untitled song", artist=$("songArtist").value.trim(), videoId=extractVideoId($("youtubeUrl").value);
    if(!videoId)return toast("Add a valid YouTube link.");
    const song={
      id:crypto.randomUUID(),title,artist,videoId,bpm:Number($("bpm").value)||72,timeSig:$("timeSig").value,
      chartText:state.analysisText,sections:(state.setupSections.length?state.setupSections:heuristicSections(state.analysisText||"")).map((s,i)=>({...s,start:Number(s.start)||0})),
      beatOffset:0,pdfName:$("pdfFile").files[0]?.name||"",createdAt:Date.now()
    };
    state.songs=[song,...state.songs];save();state.currentSongId=song.id;toast("Song saved.");openPage("library");loadPractice(song.id);
  };

  function loadPractice(id){
    state.currentSongId=id; const song=state.songs.find(s=>s.id===id); if(!song)return;
    $("practiceTitle").textContent=song.title;$("practiceArtist").textContent=song.artist||"";
    $("practiceBpm").value=song.bpm;$("offsetRange").value=song.beatOffset||0;$("offsetValue").textContent=(song.beatOffset||0).toFixed(2)+"s";
    $("chartText").textContent=sectionChart(song,0);
    renderPracticeTimeline(song);
    state.lastBeat=-1; state.loopOn=false; $("loopSectionBtn").textContent="Loop section";
    openPage("practice");
    const player=state.practicePlayer;
    if(player && state.playerReady.practice){ player.loadVideoById(song.videoId); }
  }

  function sectionForTime(song,t){
    let idx=0;
    for(let i=0;i<song.sections.length;i++){if(t>=Number(song.sections[i].start||0))idx=i;}
    return Math.min(idx,song.sections.length-1);
  }
  function sectionChart(song,idx){
    const s=song.sections?.[idx]; if(!s)return "No chart loaded.";
    const lines=[s.name||"Section", "", ...(s.chords||[])];
    return lines.join("  ");
  }
  function renderPracticeTimeline(song){
    const box=$("practiceTimeline"); box.innerHTML="";
    song.sections.forEach((s,i)=>{const b=document.createElement("button");b.className="timeline-btn";b.textContent=s.name;b.onclick=()=>state.practicePlayer?.seekTo(Number(s.start)||0,true);box.appendChild(b);});
  }

  $("playPauseBtn").onclick=()=>{
    if(!state.practicePlayer)return;
    const st=state.practicePlayer.getPlayerState?.(); if(st===YT.PlayerState.PLAYING)state.practicePlayer.pauseVideo(); else state.practicePlayer.playVideo();
  };
  $("rewindBtn").onclick=()=>state.practicePlayer?.seekTo(Math.max(0,(state.practicePlayer.getCurrentTime?.()||0)-10),true);
  $("forwardBtn").onclick=()=>state.practicePlayer?.seekTo((state.practicePlayer.getCurrentTime?.()||0)+10,true);
  $("speedSelect").onchange=e=>state.practicePlayer?.setPlaybackRate(Number(e.target.value));
  $("practiceBpm").oninput=e=>{const s=state.songs.find(x=>x.id===state.currentSongId);if(s){s.bpm=Number(e.target.value)||s.bpm;save();}};
  $("offsetRange").oninput=e=>{$("offsetValue").textContent=Number(e.target.value).toFixed(2)+"s"; const s=state.songs.find(x=>x.id===state.currentSongId);if(s){s.beatOffset=Number(e.target.value);save();}};
  $("clickToggle").onclick=()=>{state.clickOn=!state.clickOn;$("clickToggle").classList.toggle("on",state.clickOn);$("clickText").textContent=state.clickOn?"Click on":"Click off";if(!state.clickOn)stopAudio();};
  $("loopSectionBtn").onclick=()=>{state.loopOn=!state.loopOn;$("loopSectionBtn").textContent=state.loopOn?"Looping section":"Loop section";};

  $("tapBeatBtn").onclick=()=>{
    const s=state.songs.find(x=>x.id===state.currentSongId);if(!s||!state.practicePlayer)return;
    const now=Number(state.practicePlayer.getCurrentTime().toFixed(3)); const bpm=s.bpm, beat=60/bpm;
    const snapped=Math.round(now/beat)*beat; const offset=Number((now-snapped).toFixed(3));
    $("offsetRange").value=offset;$("offsetValue").textContent=offset.toFixed(2)+"s";s.beatOffset=offset;save();toast("Downbeat offset calibrated.");
  };
  $("progressBar").parentElement.onclick=e=>{
    if(!state.practicePlayer)return; const r=e.currentTarget.getBoundingClientRect(); const p=(e.clientX-r.left)/r.width;state.practicePlayer.seekTo((state.practicePlayer.getDuration()||0)*p,true);
  };

  function audioCtx(){ if(!state.audio) state.audio=new (window.AudioContext||window.webkitAudioContext)(); return state.audio; }
  function tick(accent=false){
    const ctx=audioCtx(), osc=ctx.createOscillator(), gain=ctx.createGain();
    osc.frequency.value=accent?1320:880; gain.gain.setValueAtTime(0.0001,ctx.currentTime);gain.gain.exponentialRampToValueAtTime(accent?.12:.075,ctx.currentTime+.002);gain.gain.exponentialRampToValueAtTime(.0001,ctx.currentTime+.055);
    osc.connect(gain).connect(ctx.destination);osc.start();osc.stop(ctx.currentTime+.06);
  }
  function stopAudio(){state.lastBeat=-1;}
  function updatePractice(){
    const player=state.practicePlayer; const song=state.songs.find(x=>x.id===state.currentSongId); if(!player||!song)return;
    let t=player.getCurrentTime?.()||0; const dur=player.getDuration?.()||0; $("currentTime").textContent=fmt(t);$("duration").textContent=fmt(dur);$("progressBar").style.width=dur?`${(t/dur)*100}%`:"0%";
    const idx=sectionForTime(song,t), s=song.sections[idx], next=song.sections[idx+1];
    $("currentSection").textContent=s?.name||"Ready"; $("nextSection").textContent=next?`Next — ${next.name}`:"End";
    document.querySelectorAll(".timeline-btn").forEach((b,i)=>b.classList.toggle("active",i===idx));
    $("chartText").textContent=sectionChart(song,idx);
    const chords=s?.chords?.length?s.chords:["—"]; const sectionStart=Number(s?.start)||0; const nextStart=Number(next?.start)||dur||sectionStart+240;
    const beatDur=60/(Number(song.bpm)||72); const elapsed=Math.max(0,t-sectionStart); const chordSlot=Math.min(chords.length-1,Math.floor(elapsed/(beatDur*(Number(s?.beatsPerChord)||4)))); $("activeChord").textContent=chords[chordSlot]||"—";$("nextChord").textContent=chords[Math.min(chords.length-1,chordSlot+1)]||"—";
    const beat=Math.floor(((t-(song.beatOffset||0))/beatDur)+0.0001); $("beatNumber").textContent=((beat%4)+4)%4+1;
    if(state.clickOn && player.getPlayerState?.()===YT.PlayerState.PLAYING){
      if(beat!==state.lastBeat){state.lastBeat=beat; if(beat>=0) tick(beat%4===0);}
    } else state.lastBeat=-1;
    if(state.loopOn && next && t >= Number(next.start)){player.seekTo(Number(s.start)||0,true);}
    else if(state.loopOn && !next && dur && t>=dur-0.15){player.seekTo(Number(s.start)||0,true);}
  }
  function startLoop(){if(state.raf)return;const loop=()=>{state.raf=requestAnimationFrame(loop);updatePractice();};state.raf=requestAnimationFrame(loop);}
  function stopLoop(){if(state.raf){cancelAnimationFrame(state.raf);state.raf=null;}} // kept for future route optimization

  $("demoBtn").onclick=()=>{
    const demo={id:crypto.randomUUID(),title:"Example — Rehearsal Flow",artist:"Demo arrangement",videoId:"dQw4w9WgXcQ",bpm:72,timeSig:"4/4",chartText:"INTRO\nG  D  Em  C\n\nVERSE 1\nG  D  Em  C\n\nCHORUS\nC  G  D  Em\n\nBRIDGE\nEm  C  G  D",sections:[
      {name:"Intro",start:0,chords:["G","D","Em","C"],beatsPerChord:4},{name:"Verse 1",start:18,chords:["G","D","Em","C"],beatsPerChord:4},{name:"Chorus",start:42,chords:["C","G","D","Em"],beatsPerChord:4},{name:"Bridge",start:72,chords:["Em","C","G","D"],beatsPerChord:4}],beatOffset:0,pdfName:"Demo"};
    state.songs=[demo,...state.songs];save();renderLibrary();toast("Example song loaded.");
  };

  // Initial UI
  renderLibrary();
  window.addEventListener("beforeunload",()=>stopLoop());
})();
