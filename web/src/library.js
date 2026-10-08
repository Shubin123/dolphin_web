import { readGameId } from "./game-profiles.js";

export function filterGames(games, query, region, sort) {
  const filtered = games.filter(g => g.name.toLowerCase().includes(query.toLowerCase()) && (region === "all" || g.region === region));
  return filtered.sort((a,b) => sort === "recent" ? b.added - a.added : a.name.localeCompare(b.name));
}
const supported = /\.(iso|gcm|rvz|ciso|wbfs|dol|elf)$/i;
export async function initLibrary({ mountFile }) {
  const section = document.createElement("section");
  section.className = "library-section";
  section.setAttribute("aria-label", "Game library");
  section.innerHTML = `<h2>Game Library <span id="libraryCount">0</span></h2>
    <p class="library-note">Add your GameCube / Wii images. Saved games stay in this browser's private storage.</p>
    <div class="library-toolbar"><button id="libraryAdd">Add games</button><input id="libraryFiles" type="file" multiple accept=".iso,.gcm,.rvz,.ciso,.wbfs,.dol,.elf" hidden>
    <input id="librarySearch" type="search" placeholder="Search games…" aria-label="Search games"><select id="libraryRegion" aria-label="Region"><option value="all">All regions</option><option>USA</option><option>Europe</option><option>Japan</option><option>Other</option></select>
    <select id="librarySort" aria-label="Sort"><option value="title">Title A–Z</option><option value="recent">Recently added</option></select></div>
    <p id="libraryStatus" class="library-note" role="status"></p>
    <table class="library-table"><thead><tr><th>Title</th><th>Region</th><th class="size-column">Size</th><th>Actions</th></tr></thead><tbody id="libraryRows"></tbody></table>
    <div class="library-toolbar"><button id="libraryPrev">Previous</button><span id="libraryPage"></span><button id="libraryNext">Next</button></div>`;
  document.querySelector(".play-area").append(section);
  const el = id => section.querySelector(`#${id}`);
  const status = message => { el("libraryStatus").textContent = message; };
  let directory;
  let games = [];
  let page = 1;
  const sessionFiles = new Map();
  let busy = false;
  try {
    directory = await (await navigator.storage.getDirectory()).getDirectoryHandle("dolphin-library-v1", { create:true });
    for await (const [key, handle] of directory.entries()) {
      if (handle.kind !== "file" || !key.endsWith(".json")) continue;
      try { games.push(JSON.parse(await (await handle.getFile()).text())); } catch { /* Ignore interrupted metadata writes. */ }
    }
  } catch { status("Persistent storage unavailable. Added games will be available for this session."); }
  async function play(game) {
    if (busy) return;
    busy = true;
    try {
      const blob = sessionFiles.get(game.key) || await (await directory.getFileHandle(game.key)).getFile();
      const file = new File([blob], game.name, { type:"application/octet-stream" });
      status(`Loading ${game.name}…`);
      if (await mountFile(file) === false) throw new Error("The emulator rejected this image; see the emulator status for details.");
      document.querySelector("#screen").scrollIntoView({ behavior:"smooth", block:"center" });
      status(`Selected ${game.name}`);
    } catch(error) { status(`Unable to load game: ${error.message}`); }
    finally { busy = false; }
  }
  function render() {
    const filtered = filterGames(games, el("librarySearch").value, el("libraryRegion").value, el("librarySort").value);
    const pages = Math.max(1, Math.ceil(filtered.length / 20));
    page = Math.min(page, pages);
    el("libraryCount").textContent = `(${games.length})`;
    el("libraryPage").textContent = `${page} / ${pages}`;
    el("libraryPrev").disabled = page === 1;
    el("libraryNext").disabled = page === pages;
    el("libraryRows").replaceChildren();
    for (const game of filtered.slice((page-1)*20,page*20)) {
      const row = document.createElement("tr");
      for (const [value, cls] of [[game.name,""],[game.region,""],[`${(game.size/1024**3).toFixed(2)} GB`,"size-column"]]) {
        const cell = document.createElement("td"); cell.textContent=value; cell.className=cls; row.append(cell);
      }
      const actions = document.createElement("td");
      const button = document.createElement("button"); button.textContent="Play"; button.onclick=()=>play(game);
      const remove = document.createElement("button"); remove.textContent="Remove";
      remove.onclick=async()=>{
        try {
          if(directory && !sessionFiles.has(game.key)) {
            await directory.removeEntry(game.key);
            await directory.removeEntry(`${game.key}.json`);
          }
          sessionFiles.delete(game.key); games=games.filter(g=>g.key!==game.key); render();
        } catch(error) { status(`Unable to remove game: ${error.message}`); }
      };
      actions.append(button,remove); row.append(actions); el("libraryRows").append(row);
    }
    if (!filtered.length) {
      const row=document.createElement("tr"); const cell=document.createElement("td"); cell.colSpan=4; cell.textContent=games.length ? "No matching games." : "Your library is empty. Add a game to begin."; row.append(cell); el("libraryRows").append(row);
    }
  }
  el("libraryAdd").onclick=()=>el("libraryFiles").click();
  el("libraryFiles").onchange=async()=>{
    el("libraryAdd").disabled=true;
    for(const file of el("libraryFiles").files) {
      if (!supported.test(file.name)) { status(`Unsupported file: ${file.name}`); continue; }
      const key=crypto.randomUUID();
      let gameId=""; try { gameId=await readGameId(file) || ""; } catch {}
      const region=({E:"USA",P:"Europe",J:"Japan"})[gameId[3]] || "Other";
      const game={ key,name:file.name,size:file.size,gameId,region,added:Date.now() };
      status(`Saving ${file.name} to browser storage…`);
      try {
        if(directory) {
          const output=await (await directory.getFileHandle(key,{create:true})).createWritable();
          await file.stream().pipeTo(output);
          const metadata=await (await directory.getFileHandle(`${key}.json`,{create:true})).createWritable();
          await metadata.write(JSON.stringify(game)); await metadata.close();
        } else sessionFiles.set(key,file);
        games.push(game); status(`Added ${file.name}`);
      } catch(error) {
        if(directory) { await directory.removeEntry(key).catch(()=>{}); await directory.removeEntry(`${key}.json`).catch(()=>{}); }
        status(`Unable to save ${file.name}: ${error.message}. Use Open disc for session play.`);
      }
    }
    el("libraryFiles").value=""; el("libraryAdd").disabled=false; render();
  };
  for(const name of ["librarySearch","libraryRegion","librarySort"]) el(name).addEventListener("input",()=>{page=1;render();});
  el("libraryPrev").onclick=()=>{page--;render();}; el("libraryNext").onclick=()=>{page++;render();};
  render();
}
