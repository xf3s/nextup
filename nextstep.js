const STORAGE_KEY = 'nextstep_data';
function defaultData() { return { categories: [], projects: [], archive: [], inbox: [], uncategorized: [], version: 3 }; }
function migrateTask(t) {
  if (!t.children) t.children = [];
  // v1 used 'subtasks' as flat array with {id,name,completed}
  if (t.subtasks && t.subtasks.length) {
    for (const s of t.subtasks) { t.children.push({ id: s.id, name: s.name, completed: !!s.completed, categoryIds: [], children: [] }); }
    delete t.subtasks;
  }
  if (!t.categoryIds) t.categoryIds = [];
  for (const c of t.children) migrateTask(c);
}
function loadData() {
  const raw = localStorage.getItem(STORAGE_KEY);
  if (!raw) return defaultData();
  let d;
  try { d = JSON.parse(raw); } catch(e) { return defaultData(); }
  if (!d.archive) d.archive=[];
  if (!d.inbox) d.inbox=[];
  if (!d.uncategorized) d.uncategorized=[];
  for (const p of d.projects) { if (!p.categoryIds) p.categoryIds=[]; for (const t of p.tasks) migrateTask(t); }
  for (const p of d.archive) { if (!p.categoryIds) p.categoryIds=[]; for (const t of p.tasks) migrateTask(t); }
  for (const t of d.inbox) migrateTask(t);
  for (const t of d.uncategorized) migrateTask(t);
  return d;
}
function saveData(d) { localStorage.setItem(STORAGE_KEY, JSON.stringify(d)); }

let DATA = loadData();
let VIEW = { page: 'dashboard', projectId: null, filters: [], taskFilters: [], projectFilters: [] };
function uid() { return Date.now().toString(36) + Math.random().toString(36).slice(2,7); }
function esc(s) { const d = document.createElement('div'); d.textContent = s||''; return d.innerHTML; }
function toast(msg) { const el = document.createElement('div'); el.className='toast'; el.textContent=msg; document.body.appendChild(el); setTimeout(()=>el.remove(),2000); }
function closeModal() { const o = document.querySelector('.modal-overlay'); if(o) o.remove(); }

function makeTask(name) { return { id: uid(), name, categoryIds: [], children: [], completed: false }; }

function countTasks(t) { let total=1, done=t.completed?1:0; for(const c of t.children){const r=countTasks(c);total+=r.total;done+=r.done;} return{total,done}; }
function countProjectTasks(p) { let total=0,done=0; for(const t of p.tasks){const r=countTasks(t);total+=r.total;done+=r.done;} return{total,done}; }

// Next step: deepest first incomplete leaf (children are prerequisites)
function getNextStep(proj) {
  for (const t of proj.tasks) { const r = drillNext(t,[]); if(r) return r; }
  return null;
}
function drillNext(task, ancestors) {
  if (task.completed) return null;
  for (const c of task.children) { const r = drillNext(c, [...ancestors, task]); if(r) return r; }
  return { task, ancestors, atom: task.name };
}

function getTaskEffectiveCats(projCatIds, task, ancestors) {
  const s = new Set(projCatIds);
  for (const a of ancestors) for (const id of a.categoryIds) s.add(id);
  for (const id of (task.categoryIds||[])) s.add(id);
  return [...s];
}

function matchesFilters(proj, filters) {
  if (!filters.length) return true;
  const step = getNextStep(proj);
  if (!step) return false;
  const eff = getTaskEffectiveCats(proj.categoryIds, step.task, step.ancestors);
  return filters.every(f => eff.includes(f));
}

function findTask(tasks, id, parent=null) {
  for (let i = 0; i < tasks.length; i++) {
    if (tasks[i].id === id) return { task: tasks[i], list: tasks, index: i, parent };
    const r = findTask(tasks[i].children, id, tasks[i]);
    if (r) return r;
  }
  return null;
}

function getTaskList(pid) { return pid === '__inbox' ? DATA.inbox : pid === '__uncategorized' ? DATA.uncategorized : DATA.projects.find(p=>p.id===pid)?.tasks; }
function getProjectObj(pid) { return (pid === '__inbox' || pid === '__uncategorized') ? null : DATA.projects.find(p=>p.id===pid); }

function markDone(t) { t.completed = true; t.children.forEach(markDone); }
function uncompleteChain(list, tid) {
  const f = findTask(list, tid);
  if (!f) return;
  f.task.completed = false;
  if (f.parent) uncompleteChain(list, f.parent.id);
}

// ── Render ──
function render() {
  let h = `<div class="topbar"><h1>nextup</h1><div class="topbar-actions">
    <button class="btn-icon" onclick="showDataModal()" title="Import/Export">⇄</button>
    <button class="btn-icon" onclick="showCategoryModal()" title="Categories">⚙</button>
  </div></div>`;

  h += `<div class="nav">
    <button class="${VIEW.page==='dashboard'?'active':''}" onclick="nav('dashboard')">Next</button>
    <button class="${VIEW.page==='projects'?'active':''}" onclick="nav('projects')">Projects</button>
    <button class="${VIEW.page==='tasks'?'active':''}" onclick="nav('tasks')">Tasks</button>
    ${VIEW.page==='project'?`<button class="active">Detail</button>`:''}
    ${VIEW.page==='archive'?`<button class="active">Archive</button>`:''}
  </div>`;

  if (VIEW.page==='dashboard') h += renderDashboard();
  else if (VIEW.page==='projects') h += renderProjects();
  else if (VIEW.page==='tasks') h += renderAllTasks();
  else if (VIEW.page==='project') h += renderProject();
  else if (VIEW.page==='archive') h += renderArchive();

  document.getElementById('app').innerHTML = h;
}

function renderFilterBar(arr, key) {
  if (!DATA.categories.length) return '';
  let h = '<div class="tag-bar">';
  for (const c of DATA.categories) {
    h += `<span class="tag ${arr.includes(c.id)?'active':''}" onclick="toggleF('${key}','${c.id}')">${esc(c.name)}</span>`;
  }
  if (arr.length) h += `<button class="btn-ghost" onclick="clearF('${key}')">clear</button>`;
  return h + '</div>';
}

// ── Dashboard ──
function renderDashboard() {
  let h = renderFilterBar(VIEW.filters, 'filters');
  const sources = [];

  for (const p of DATA.projects) {
    if (!matchesFilters(p, VIEW.filters)) continue;
    const step = getNextStep(p);
    if (step) sources.push({ proj: p, step, id: p.id });
  }
  // Uncategorized — all actionable loose tasks go to Next Steps
  const uncatP = { tasks: DATA.uncategorized, categoryIds: [], name: 'uncategorized' };
  if (uncatP.tasks.length && matchesFilters(uncatP, VIEW.filters)) {
    const step = getNextStep(uncatP);
    if (step) sources.push({ proj: uncatP, step, id: '__uncategorized' });
  }

  if (!sources.length && !DATA.projects.length && !DATA.uncategorized.length && !DATA.inbox.length) {
    return h + `<div class="empty"><div class="empty-icon">◇</div><p>no projects yet.<br><br><button class="btn-accent" onclick="nav('projects')">add a project</button></p></div>`;
  }
  if (!sources.length) {
    h += `<div class="empty"><p>nothing actionable${VIEW.filters.length?' with those filters':''}.</p></div>`;
  }

  for (const { proj, step, id } of sources) {
    const cats = getTaskEffectiveCats(proj.categoryIds, step.task, step.ancestors).map(cid=>DATA.categories.find(c=>c.id===cid)).filter(Boolean);
    const path = step.ancestors.map(a=>a.name);
    h += `<div class="card nextstep-card"><div class="nextstep-project">${esc(proj.name)}</div>`;
    if (path.length) h += `<div class="nextstep-path">${path.map(esc).join(' → ')}</div>`;
    h += `<div class="nextstep-action">${esc(step.atom)}</div>`;
    if (cats.length) { h += '<div class="card-meta">'; for(const c of cats) h+=`<span class="tag">${esc(c.name)}</span>`; h+='</div>'; }
    h += `<div style="display:flex;gap:8px;margin-top:10px;">
      <button class="nextstep-complete-btn" onclick="completeDash('${id}')">✓ done</button>`;
    if (id !== '__inbox' && id !== '__uncategorized') h += `<button class="btn btn-sm" onclick="openProject('${id}')">open</button>`;
    h += '</div></div>';
  }

  // Completed projects
  const allDone = DATA.projects.filter(p => { const s=getNextStep(p); return !s && p.tasks.length>0; });
  if (allDone.length) {
    h += `<div class="section-label">all steps complete</div>`;
    for (const p of allDone) {
      h += `<div class="card card-done-row">
        <div><div class="card-title">${esc(p.name)}</div><div class="card-sub" style="color:var(--complete);">✓ done</div></div>
        <button class="btn btn-sm" onclick="archiveProject('${p.id}')">archive</button></div>`;
    }
  }

  if (DATA.archive.length) h += `<div style="margin-top:20px;text-align:center;"><button class="btn-ghost" onclick="nav('archive')">graveyard (${DATA.archive.length})</button></div>`;
  return h;
}

function completeDash(pid) {
  const proj = pid==='__inbox' ? {tasks:DATA.inbox,categoryIds:[],name:'inbox'} : pid==='__uncategorized' ? {tasks:DATA.uncategorized,categoryIds:[],name:'uncategorized'} : DATA.projects.find(p=>p.id===pid);
  if(!proj) return;
  const step = getNextStep(proj);
  if(!step) return;
  markDone(step.task);
  saveData(DATA); toast('done ✓'); render();
}

// ── Projects ──
function renderProjects() {
  let h = renderFilterBar(VIEW.projectFilters, 'projectFilters');
  const pf = VIEW.projectFilters;
  const visibleProjects = pf.length ? DATA.projects.filter(p => pf.every(f => p.categoryIds.includes(f))) : DATA.projects;

  h += `<div class="section-label">uncategorized tasks</div>`;
  h += renderTaskTree(DATA.uncategorized, '__uncategorized', 0, true);
  h += `<div class="inline-add" style="margin-top:8px;"><input type="text" placeholder="add loose task..." id="add-uncat-input" onkeydown="if(event.key==='Enter')addTask('add-uncat-input',DATA.uncategorized)"><button class="btn-accent btn-sm" onclick="addTask('add-uncat-input',DATA.uncategorized)">+</button></div>`;

  h += `<div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:12px;margin-top:24px;">
    <span style="font-size:13px;color:var(--text-dim);">${visibleProjects.length} project${visibleProjects.length!==1?'s':''}</span>
    <button class="btn-accent btn-sm" onclick="showProjectModal()">+ project</button></div>`;

  if (!visibleProjects.length) h += `<div class="empty"><div class="empty-icon">◇</div><p>${pf.length ? 'nothing matches those filters.' : 'start by adding a project.'}</p></div>`;

  for (const p of visibleProjects) {
    const{total,done}=countProjectTasks(p); const pct=total?Math.round(done/total*100):0;
    const step=getNextStep(p);
    const cats=p.categoryIds.map(id=>DATA.categories.find(c=>c.id===id)).filter(Boolean);
    h += `<div class="card" onclick="openProject('${p.id}')" style="cursor:pointer;"><div class="card-title">${esc(p.name)}</div>`;
    if(p.description) h+=`<div class="card-sub">${esc(p.description)}</div>`;
    if(step) { const path=[...step.ancestors.map(a=>a.name),step.atom]; h+=`<div class="project-next-hint">next: ${esc(path.join(' → '))}</div>`; }
    else if(total) h+=`<div class="project-complete-hint">✓ complete</div>`;
    if(cats.length){h+='<div class="card-meta">';for(const c of cats)h+=`<span class="tag">${esc(c.name)}</span>`;h+='</div>';}
    if(total) h+=`<div class="progress"><div class="progress-fill" style="width:${pct}%"></div></div><div class="progress-count">${done}/${total}</div>`;
    h+='</div>';
  }

  h += `<div class="section-label" style="margin-top:24px;">inbox</div>`;
  h += renderTaskTree(DATA.inbox, '__inbox', 0, true);
  h += `<div class="inline-add" style="margin-top:8px;"><input type="text" placeholder="capture to inbox..." id="add-inbox-input" onkeydown="if(event.key==='Enter')addTask('add-inbox-input',DATA.inbox)"><button class="btn-accent btn-sm" onclick="addTask('add-inbox-input',DATA.inbox)">+</button></div>`;

  if(DATA.archive.length) h+=`<div style="margin-top:20px;text-align:center;"><button class="btn-ghost" onclick="nav('archive')">graveyard (${DATA.archive.length})</button></div>`;
  return h;
}

// ── All Tasks ──
function renderAllTasks() {
  let h = renderFilterBar(VIEW.taskFilters, 'taskFilters');
  const af = VIEW.taskFilters;

  function matches(t, inherited) {
    if(!af.length) return true;
    const eff = new Set([...inherited, ...(t.categoryIds||[])]);
    return af.every(f=>eff.has(f));
  }
  function renderFiltered(tasks, inherited, pid) {
    let out='';
    for(const t of tasks) {
      const m = matches(t, inherited);
      const childInherited = [...inherited, ...(t.categoryIds||[])];
      const childHtml = renderFiltered(t.children, childInherited, pid);
      if(m || childHtml) {
        const tCats=(t.categoryIds||[]).map(id=>DATA.categories.find(c=>c.id===id)).filter(Boolean);
        out += `<div class="task-node"><div class="task-row">
          <div class="task-check ${t.completed?'checked':''} sm" onclick="toggleT('${pid}','${t.id}')">${t.completed?'✓':''}</div>
          <div class="task-content"><div class="task-name ${t.completed?'done':''}">${esc(t.name)}</div>
          ${tCats.length?'<div class="card-meta" style="margin-top:3px;">'+tCats.map(c=>`<span class="tag">${esc(c.name)}</span>`).join('')+'</div>':''}</div></div>`;
        if(childHtml) out+=`<div class="task-children">${childHtml}</div>`;
        out+='</div>';
      }
    }
    return out;
  }

  let any = false;
  if(DATA.uncategorized.length) {
    const content = renderFiltered(DATA.uncategorized, [], '__uncategorized');
    if(content) { any=true; h+=`<div class="tasks-project-header">uncategorized</div>`+content; }
  }
  for(const p of DATA.projects) {
    const content = renderFiltered(p.tasks, p.categoryIds, p.id);
    if(content) { any=true; h+=`<div class="tasks-project-header" onclick="openProject('${p.id}')">${esc(p.name)}</div>`+content; }
  }
  if(DATA.inbox.length) {
    const content = renderFiltered(DATA.inbox, [], '__inbox');
    if(content) { any=true; h+=`<div class="tasks-project-header">inbox</div>`+content; }
  }
  if(!any) h+=`<div class="empty"><p>${af.length?'nothing matches those filters.':'no tasks yet.'}</p></div>`;
  return h;
}

// ── Project Detail ──
function renderProject() {
  const p = DATA.projects.find(x=>x.id===VIEW.projectId);
  if(!p){nav('projects');return '';}
  let h = `<div class="breadcrumb"><span onclick="nav('projects')">projects</span> / ${esc(p.name)}</div>`;
  h += `<div class="project-detail-header">
    <div><h2 style="font-size:18px;font-weight:600;color:var(--text-bright);">${esc(p.name)}</h2>
    ${p.description?`<p style="font-size:13px;color:var(--text-dim);margin-top:2px;">${esc(p.description)}</p>`:''}</div>
    <div class="project-detail-actions">
      <button class="btn-icon btn-sm" onclick="showProjectModal('${p.id}')" title="Edit">✎</button>
      <button class="btn btn-sm" onclick="archiveProject('${p.id}')">archive</button>
      <button class="btn-icon btn-sm btn-danger" onclick="deleteProject('${p.id}')" title="Delete">×</button>
    </div></div>`;

  const cats=p.categoryIds.map(id=>DATA.categories.find(c=>c.id===id)).filter(Boolean);
  if(cats.length){h+='<div class="card-meta" style="margin-bottom:12px;">';for(const c of cats)h+=`<span class="tag">${esc(c.name)}</span>`;h+='</div>';}

  h += '<div style="margin-top:12px;">' + renderTaskTree(p.tasks, p.id, 0, true) + '</div>';
  h += `<div class="inline-add" style="margin-top:12px;"><input type="text" placeholder="add task..." id="add-task-input" onkeydown="if(event.key==='Enter')addTaskQ('${p.id}')"><button class="btn-accent btn-sm" onclick="addTaskQ('${p.id}')">+</button></div>`;
  return h;
}

// ── Recursive task tree ──
function renderTaskTree(tasks, pid, depth, editable) {
  let h = '';
  for(let i=0;i<tasks.length;i++) {
    const t = tasks[i];
    const tCats=(t.categoryIds||[]).map(id=>DATA.categories.find(c=>c.id===id)).filter(Boolean);
    const ckCls = depth>0?'sm':'';

    h += `<div class="task-node"><div class="task-row">`;
    if(editable) {
      h += `<div class="task-reorder-col">
        ${i>0?`<button class="btn-ghost" style="font-size:9px;padding:0 3px;line-height:1;" onclick="moveT('${pid}','${t.id}',-1)">▲</button>`:'<div style="height:14px"></div>'}
        ${i<tasks.length-1?`<button class="btn-ghost" style="font-size:9px;padding:0 3px;line-height:1;" onclick="moveT('${pid}','${t.id}',1)">▼</button>`:''}
      </div>`;
    }
    h += `<div class="task-check ${t.completed?'checked':''} ${ckCls}" onclick="toggleT('${pid}','${t.id}')">${t.completed?'✓':''}</div>
      <div class="task-content"><div class="task-name ${t.completed?'done':''}">${esc(t.name)}</div>
      ${tCats.length?'<div class="card-meta" style="margin-top:3px;">'+tCats.map(c=>`<span class="tag">${esc(c.name)}</span>`).join('')+'</div>':''}</div>`;
    if(editable) {
      h += `<div class="task-actions">
        <button class="btn-ghost" onclick="showTaskModal('${pid}','${t.id}')" title="Edit">✎</button>
        <button class="btn-ghost" onclick="promoteTask('${pid}','${t.id}')" title="Promote">⤴</button>
        <button class="btn-ghost btn-danger" onclick="deleteT('${pid}','${t.id}')">×</button>
      </div>`;
    }
    h += '</div>';

    if(t.children.length) {
      const capCls = depth>=2 ? 'depth-cap' : '';
      h += `<div class="task-children ${capCls}">${renderTaskTree(t.children, pid, depth+1, editable)}</div>`;
    }

    if(editable) {
      h += `<div class="inline-add" style="margin-left:${Math.min((depth+1),3)*16}px;margin-top:2px;margin-bottom:4px;">
        <input type="text" placeholder="add step..." id="addc-${t.id}" style="font-size:12px;padding:5px 8px;" onkeydown="if(event.key==='Enter')addChild('${pid}','${t.id}')">
        <button class="btn btn-sm" onclick="addChild('${pid}','${t.id}')">+</button></div>`;
    }
    h += '</div>';
  }
  return h;
}

// ── Archive ──
function renderArchive() {
  let h = `<div class="breadcrumb"><span onclick="nav('dashboard')">dashboard</span> / graveyard</div><div class="section-label">archived projects</div>`;
  if(!DATA.archive.length) return h+`<div class="empty"><p>nothing here yet.</p></div>`;
  for(const p of DATA.archive) {
    const{total,done}=countProjectTasks(p);
    h+=`<div class="card" style="opacity:0.6;"><div class="archive-card-row">
      <div><div class="card-title">${esc(p.name)}</div>${p.description?`<div class="card-sub">${esc(p.description)}</div>`:''}<div class="card-sub">${done}/${total} tasks</div></div>
      <div class="project-detail-actions"><button class="btn btn-sm" onclick="unarchive('${p.id}')">restore</button><button class="btn btn-sm btn-danger" onclick="permaDel('${p.id}')">delete</button></div></div></div>`;
  }
  return h;
}

// ── Nav ──
function nav(p) { VIEW.page=p; if(p!=='project')VIEW.projectId=null; render(); }
function openProject(id) { VIEW.page='project'; VIEW.projectId=id; render(); }
function toggleF(k,id) { const a=VIEW[k]; const i=a.indexOf(id); if(i>=0)a.splice(i,1);else a.push(id); render(); }
function clearF(k) { VIEW[k]=[]; render(); }

function renderCategoryCheckboxes(categories, selectedIds, cls) {
  return categories.map(c=>`<label style="display:flex;gap:6px;align-items:center;font-size:13px;cursor:pointer;"><input type="checkbox" class="${cls}" value="${c.id}" ${selectedIds.includes(c.id)?'checked':''}> ${esc(c.name)}</label>`).join('');
}

// ── Project CRUD ──
function showProjectModal(editId) {
  const ex = editId ? DATA.projects.find(p=>p.id===editId) : null;
  const nm=ex?ex.name:'', desc=ex?(ex.description||''):'', cids=ex?(ex.categoryIds||[]):[];
  let cbs = renderCategoryCheckboxes(DATA.categories, cids, 'proj-cat-cb');
  const html=`<div class="modal-overlay" onclick="if(event.target===this)closeModal()"><div class="modal">
    <div class="modal-header"><h2>${ex?'Edit':'New'} Project</h2><button class="btn-icon" onclick="closeModal()">×</button></div>
    <div class="form-row"><label class="form-label">Name</label><input type="text" id="proj-name" value="${esc(nm)}"></div>
    <div class="form-row"><label class="form-label">Description</label><textarea id="proj-desc">${esc(desc)}</textarea></div>
    <div class="form-row"><label class="form-label">Categories</label><div style="display:flex;flex-wrap:wrap;gap:8px;margin-top:4px;">${cbs||'<span style="font-size:12px;color:var(--text-dim);">add via ⚙</span>'}</div></div>
    <div class="modal-actions"><button class="btn" onclick="closeModal()">Cancel</button><button class="btn-accent" onclick="saveProj(${editId?`'${editId}'`:'null'})">${ex?'Save':'Create'}</button></div>
  </div></div>`;
  document.body.insertAdjacentHTML('beforeend',html);
  document.getElementById('proj-name').focus();
}
function saveProj(eid) {
  const nm=document.getElementById('proj-name').value.trim(); if(!nm)return;
  const desc=document.getElementById('proj-desc').value.trim();
  const cids=[...document.querySelectorAll('.proj-cat-cb:checked')].map(c=>c.value);
  if(eid){const p=DATA.projects.find(x=>x.id===eid);if(p){p.name=nm;p.description=desc;p.categoryIds=cids;}}
  else DATA.projects.push({id:uid(),name:nm,description:desc,categoryIds:cids,tasks:[]});
  saveData(DATA);closeModal();render();
}
function deleteProject(id) { if(!confirm('Delete this project and all its tasks?'))return; DATA.projects=DATA.projects.filter(p=>p.id!==id); saveData(DATA); if(VIEW.projectId===id)nav('projects');else render(); }
function archiveProject(id) { const i=DATA.projects.findIndex(p=>p.id===id);if(i<0)return; DATA.archive.push(DATA.projects.splice(i,1)[0]); saveData(DATA); if(VIEW.projectId===id)nav('projects');else render(); toast('archived'); }
function unarchive(id) { const i=DATA.archive.findIndex(p=>p.id===id);if(i<0)return; DATA.projects.push(DATA.archive.splice(i,1)[0]); saveData(DATA);render();toast('restored'); }
function permaDel(id) { if(!confirm('Permanently delete?'))return; DATA.archive=DATA.archive.filter(p=>p.id!==id); saveData(DATA);render(); }

// ── Task CRUD ──
function addTask(inputId, list) {
  const el=document.getElementById(inputId);const nm=el.value.trim();if(!nm)return;
  list.push(makeTask(nm));saveData(DATA);render();
  setTimeout(()=>{const e=document.getElementById(inputId);if(e)e.focus();},50);
}
function addTaskQ(pid) {
  const list=getTaskList(pid);if(!list)return;
  addTask('add-task-input', list);
}
function addChild(pid, parentId) {
  const el=document.getElementById('addc-'+parentId);const nm=el.value.trim();if(!nm)return;
  const list=getTaskList(pid);if(!list)return;
  const f=findTask(list,parentId);if(!f)return;
  f.task.children.push(makeTask(nm));
  uncompleteChain(list, parentId);
  saveData(DATA);render();
  setTimeout(()=>{const e=document.getElementById('addc-'+parentId);if(e)e.focus();},50);
}
function toggleT(pid,tid) {
  const list=getTaskList(pid);if(!list)return;
  const f=findTask(list,tid);if(!f)return;
  f.task.completed=!f.task.completed;
  if(f.task.completed) markDone(f.task);
  saveData(DATA);render();
}
function deleteT(pid,tid) {
  const list=getTaskList(pid);if(!list)return;
  const f=findTask(list,tid);if(!f)return;
  f.list.splice(f.index,1);saveData(DATA);render();
}
function moveT(pid,tid,dir) {
  const list=getTaskList(pid);if(!list)return;
  const f=findTask(list,tid);if(!f)return;
  const ni=f.index+dir;
  if(ni<0||ni>=f.list.length)return;
  [f.list[f.index],f.list[ni]]=[f.list[ni],f.list[f.index]];
  saveData(DATA);render();
}

function promoteTask(pid, tid) {
  const list = getTaskList(pid); if(!list) return;
  const f = findTask(list, tid);
  if(!f || !f.parent) { toast('already top-level'); return; }
  // Remove from parent's children
  f.list.splice(f.index, 1);
  // Find parent in tree to insert after it
  const pf = findTask(list, f.parent.id);
  if(pf) { pf.list.splice(pf.index+1, 0, f.task); }
  else { list.push(f.task); }
  saveData(DATA); render(); toast('promoted');
}

function showTaskModal(pid, tid) {
  const list=getTaskList(pid);if(!list)return;
  const f=findTask(list,tid);if(!f)return;const t=f.task;
  const projCatIds = pid==='__inbox' ? [] : (getProjectObj(pid)?.categoryIds||[]);
  const avail = DATA.categories.filter(c=>!projCatIds.includes(c.id));
  let cbs=renderCategoryCheckboxes(avail, t.categoryIds||[], 'task-cat-cb');
  const html=`<div class="modal-overlay" onclick="if(event.target===this)closeModal()"><div class="modal">
    <div class="modal-header"><h2>Edit Task</h2><button class="btn-icon" onclick="closeModal()">×</button></div>
    <div class="form-row"><label class="form-label">Name</label><input type="text" id="task-name" value="${esc(t.name)}"></div>
    <div class="form-row"><label class="form-label">Categories</label><div style="display:flex;flex-wrap:wrap;gap:8px;margin-top:4px;">${cbs||'<span style="font-size:12px;color:var(--text-dim);">none available</span>'}</div>
    ${projCatIds.length?`<div style="font-size:11px;color:var(--text-dim);margin-top:6px;">inherited: ${projCatIds.map(id=>{const c=DATA.categories.find(x=>x.id===id);return c?c.name:'';}).filter(Boolean).join(', ')}</div>`:''}</div>
    <div class="modal-actions"><button class="btn" onclick="closeModal()">Cancel</button><button class="btn-accent" onclick="saveTaskE('${pid}','${tid}')">Save</button></div>
  </div></div>`;
  document.body.insertAdjacentHTML('beforeend',html);
  document.getElementById('task-name').focus();
}
function saveTaskE(pid,tid) {
  const list=getTaskList(pid);const f=findTask(list,tid);if(!f)return;
  f.task.name=document.getElementById('task-name').value.trim()||f.task.name;
  f.task.categoryIds=[...document.querySelectorAll('.task-cat-cb:checked')].map(c=>c.value);
  saveData(DATA);closeModal();render();
}

// ── Categories ──
function showCategoryModal() {
  let cl=DATA.categories.map(c=>`<div style="display:flex;align-items:center;gap:8px;padding:6px 0;border-bottom:1px solid var(--border);"><span style="flex:1;font-size:14px;">${esc(c.name)}</span><button class="btn-icon btn-sm btn-danger" onclick="delCat('${c.id}')">×</button></div>`).join('');
  const html=`<div class="modal-overlay" onclick="if(event.target===this)closeModal()"><div class="modal">
    <div class="modal-header"><h2>Categories</h2><button class="btn-icon" onclick="closeModal()">×</button></div>
    <div>${cl||'<p style="font-size:13px;color:var(--text-dim);">no categories yet.</p>'}</div>
    <div class="inline-add" style="margin-top:12px;"><input type="text" placeholder="new category..." id="new-cat-name" onkeydown="if(event.key==='Enter')addCat()"><button class="btn-accent btn-sm" onclick="addCat()">+</button></div>
  </div></div>`;
  document.body.insertAdjacentHTML('beforeend',html);
  document.getElementById('new-cat-name').focus();
}
function addCat() {
  const el=document.getElementById('new-cat-name');const nm=el.value.trim();if(!nm)return;
  if(DATA.categories.some(c=>c.name.toLowerCase()===nm.toLowerCase())){toast('exists');return;}
  DATA.categories.push({id:uid(),name:nm});saveData(DATA);closeModal();showCategoryModal();
}
function delCat(id) {
  DATA.categories=DATA.categories.filter(c=>c.id!==id);
  function clean(t){t.categoryIds=(t.categoryIds||[]).filter(c=>c!==id);t.children.forEach(clean);}
  for(const p of DATA.projects){p.categoryIds=(p.categoryIds||[]).filter(c=>c!==id);p.tasks.forEach(clean);}
  for(const p of DATA.archive){p.categoryIds=(p.categoryIds||[]).filter(c=>c!==id);p.tasks.forEach(clean);}
  DATA.inbox.forEach(clean);
  DATA.uncategorized.forEach(clean);
  VIEW.filters=VIEW.filters.filter(f=>f!==id);
  VIEW.taskFilters=VIEW.taskFilters.filter(f=>f!==id);
  VIEW.projectFilters=VIEW.projectFilters.filter(f=>f!==id);
  saveData(DATA);closeModal();showCategoryModal();
}

// ── Import/Export ──
function showDataModal() {
  const html=`<div class="modal-overlay" onclick="if(event.target===this)closeModal()"><div class="modal">
    <div class="modal-header"><h2>Data</h2><button class="btn-icon" onclick="closeModal()">×</button></div>
    <p style="font-size:13px;color:var(--text-dim);margin-bottom:12px;">Export saves a JSON file. Import overwrites current data.</p>
    <div style="display:flex;gap:8px;"><button class="btn-accent" onclick="exportD()">Export JSON</button><button class="btn" onclick="document.getElementById('import-file').click()">Import JSON</button><input type="file" id="import-file" accept=".json" style="display:none" onchange="importD(event)"></div>
    <div style="margin-top:16px;padding-top:12px;border-top:1px solid var(--border);"><button class="btn btn-danger btn-sm" onclick="if(confirm('Erase everything?')){DATA=defaultData();saveData(DATA);closeModal();render();toast('reset');}">Reset All Data</button></div>
  </div></div>`;
  document.body.insertAdjacentHTML('beforeend',html);
}
function exportD() {
  const b=new Blob([JSON.stringify(DATA,null,2)],{type:'application/json'});
  const a=document.createElement('a');a.href=URL.createObjectURL(b);a.download='nextstep-data.json';a.click();URL.revokeObjectURL(a.href);toast('exported');
}
function importD(ev) {
  const f=ev.target.files[0];if(!f)return;const r=new FileReader();
  r.onload=function(e){try{const d=JSON.parse(e.target.result);if(d.projects&&d.categories){if(!d.archive)d.archive=[];if(!d.inbox)d.inbox=[];if(!d.uncategorized)d.uncategorized=[];DATA=d;saveData(DATA);closeModal();render();toast('imported');}else toast('invalid');}catch(err){toast('parse error');}};
  r.readAsText(f);
}

render();
