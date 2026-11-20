'use strict';

const {defaults,kinds,clone,parseCsv,scan,retrieve,validateGraph,run} = Loom;
const $ = selector => document.querySelector(selector);
const escapeHtml = value => String(value ?? '').replace(/[&<>"']/g, char => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[char]));
const h = escapeHtml;
const json = value => JSON.stringify(value,null,2);
const paths = {
  logo:'<path d="M4 5h11l5 5-5 5H4M4 12h11l5 5-3 3H4M7 3v18"/>', layers:'<path d="m12 3 9 5-9 5-9-5 9-5ZM3 12l9 5 9-5M3 16l9 5 9-5"/>',
  graph:'<rect x="3" y="3" width="6" height="6" rx="1"/><rect x="15" y="15" width="6" height="6" rx="1"/><rect x="3" y="15" width="6" height="6" rx="1"/><path d="M6 9v6m0-3h12v3"/>',
  bot:'<rect x="4" y="7" width="16" height="13" rx="3"/><path d="M12 7V3m-4 9h.1m7.9 0h.1M9 16h6"/>', book:'<path d="M12 6c-3-3-6-3-9-2v15c3-1 6-1 9 2 3-3 6-3 9-2V4c-3-1-6-1-9 2Zm0 0v15"/>',
  pulse:'<path d="M2 12h5l3-8 4 16 3-8h5"/>', settings:'<circle cx="12" cy="12" r="3"/><path d="m8 3 1 3-2 2-3-1-1 4 3 1 1 3-2 2 3 3 2-2 3 1 1 3 4-1-1-3 2-2 3 1 1-4-3-1-1-3 2-2-3-3-2 2-3-1-1-3Z" transform="translate(1 1) scale(.88)"/>',
  play:'<path d="m8 5 12 7-12 7V5Z" fill="currentColor"/>', input:'<path d="M3 12h12m-4-4 4 4-4 4M15 4h5v16h-5"/>',
  database:'<ellipse cx="12" cy="5" rx="8" ry="3"/><path d="M4 5v14c0 4 16 4 16 0V5M4 12c0 4 16 4 16 0"/>',
  shield:'<path d="m12 3 8 3v6c0 5-8 9-8 9s-8-4-8-9V6l8-3Zm-4 9 3 3 5-6"/>',
  user:'<circle cx="12" cy="8" r="4"/><path d="M4 21v-2a6 6 0 0 1 6-6h4a6 6 0 0 1 6 6v2"/>',
  file:'<path d="M6 3h8l4 4v14H6V3Zm8 0v5h4M9 12h6m-6 4h6"/>',
  plus:'<path d="M12 5v14M5 12h14"/>', code:'<path d="m8 6-6 6 6 6m8-12 6 6-6 6m-3-15-2 18"/>',
  loop:'<path d="M6 8a7 7 0 1 1-1 7M6 3v6H1"/>', clock:'<circle cx="12" cy="12" r="9"/><path d="M12 7v5l3 2"/>',
  close:'<path d="m6 6 12 12M18 6 6 18"/>', download:'<path d="M12 3v12m-4-4 4 4 4-4M4 17v4h16v-4"/>',
  upload:'<path d="M12 16V4m-4 4 4-4 4 4M4 16v5h16v-5"/>', stop:'<rect x="6" y="6" width="12" height="12" rx="2"/>',
  adjust:'<path d="M4 6h16M4 12h16M4 18h16"/><circle cx="8" cy="6" r="2" fill="#191c17"/><circle cx="15" cy="12" r="2" fill="#191c17"/><circle cx="10" cy="18" r="2" fill="#191c17"/>'
};
const icon = name => `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.65" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${paths[name] ?? paths.graph}</svg>`;
const glyph = name => `<span data-icon="${name}">${icon(name)}</span>`;
const button = (label, action, name, cls = '', attrs = '') => `<button class="btn ${cls}" data-action="${action}" ${attrs}>${name ? glyph(name) : ''}${label}</button>`;
const pill = (label, color = '') => `<span class="pill ${color}">${h(label)}</span>`;
const statusText = {running:'执行中',review:'待人工复核',succeeded:'已通过',failed:'执行失败',blocked:'未放行',cancelled:'已停止',idle:'待运行',done:'已完成',warning:'未通过',skipped:'已跳过'};
const statusColor = {running:'blue',review:'amber',succeeded:'green',failed:'red',blocked:'amber',done:'green',warning:'amber'};
const status = value => pill(statusText[value] ?? '待运行',statusColor[value]);
const pages = {workflow:['工作流编排','graph'],agents:['Agent 团队','bot'],knowledge:['知识库','book'],runs:['运行记录','pulse'],settings:['模型设置','settings']};
const standaloneHtml = location.protocol === 'file:';
const id = () => globalThis.crypto?.randomUUID?.().slice(0,8) ?? Date.now().toString(36);
const read = (key,fallback) => {try {return JSON.parse(localStorage.getItem(key)) ?? fallback;} catch {return fallback;}};
const savedConfig = read('loomops-workflow-v1',{});
let config = {...clone(defaults),...savedConfig};
if (standaloneHtml) config.mode = 'offline';
let history = read('loomops-history-v1',[]), current = history[0]?.run ?? null;
let page = 'workflow', selected = 'verify', controller = null, key = '', storedKey = false, toastTimer, benchmark = null;
const dialog = $('#dialog');

function toast(message) {
  const element = $('#toast');
  element.textContent = message; element.classList.add('visible');
  clearTimeout(toastTimer); toastTimer = setTimeout(() => element.classList.remove('visible'),3800);
}
function persist() {
  try {localStorage.setItem('loomops-workflow-v1',JSON.stringify(config));}
  catch {toast('本地存储不可用，当前更改保留至页面关闭。');}
}
function persistHistory() {
  try {localStorage.setItem('loomops-history-v1',JSON.stringify(history));}
  catch {toast('运行结果仍在当前页面，可导出 JSON 保存。');}
}
function intro(title,description,action = '',code = '') {
  return `<section class="intro"><div>${code ? `<div class="eyebrow">${code}</div>` : ''}<h1>${h(title)}</h1><p>${h(description)}</p></div>${action}</section>`;
}
function panel(title, name, content, action = '', cls = '') {
  return `<section class="panel ${cls}"><div class="panel-head"><div>${glyph(name)}<h2>${h(title)}</h2></div>${action}</div>${content}</section>`;
}
function metric(label,value,note,name,small = false) {
  return `<div class="metric"><label>${h(label)}</label>${glyph(name)}<strong class="${small?'text':''}">${h(value)}</strong><small>${h(note)}</small></div>`;
}
const time = value => new Date(value).toLocaleTimeString('zh-CN',{hour12:false});
const elapsed = value => Number.isFinite(value) ? `${(value/1000).toFixed(2)} s` : '—';
const money = cents => (cents/100).toLocaleString('zh-CN',{minimumFractionDigits:2,maximumFractionDigits:2});

function graph() {
  const positions = new Map(config.nodes.map(node => [node.id,node]));
  const links = config.nodes.flatMap(node => node.deps.map(dep => {
    const source = positions.get(dep);
    const middle = (source.x+node.x)/2;
    const same = source.x === node.x;
    const d = same ? `M${source.x} ${source.y} V${node.y}` : `M${source.x} ${source.y} C${middle} ${source.y},${middle} ${node.y},${node.x} ${node.y}`;
    return `<path d="${d}" class="${node.when?.node === dep ? 'conditional' : ''}"/>`;
  })).join('');
  const loop = positions.has('verify') && positions.has('analysis') && config.maxLoops > 0;
  const loopHighlight = current?.loops ? '#edbf79' : '#9b7646';
  const wires = `<svg class="wires" viewBox="0 0 100 100" preserveAspectRatio="none" aria-hidden="true"><g fill="none" stroke="#67745c" stroke-width="1.45">${links.replaceAll('<path ','<path vector-effect="non-scaling-stroke" ')}</g>${loop ? `<path d="M${positions.get('verify').x} ${positions.get('verify').y} V89 H42 V${positions.get('analysis').y} H${positions.get('analysis').x}" fill="none" stroke="${loopHighlight}" stroke-width="1.5" stroke-dasharray="5 5" vector-effect="non-scaling-stroke"/>` : ''}</svg>`;
  const nodes = config.nodes.map(node => {
    const type = kinds[node.type], state = current?.states[node.id] ?? 'idle';
    return `<button class="graph-node ${state} ${selected===node.id?'selected':''}" style="left:${node.x}%;top:${node.y}%" data-action="select-node" data-id="${h(node.id)}" aria-pressed="${selected===node.id}"><span class="node-icon ${type.group}">${glyph(type.icon)}</span><span class="node-copy"><b>${h(node.name)}</b><small>${state === 'idle' ? h(type.name) : h(statusText[state])}</small></span></button>`;
  }).join('');
  const legend = [['#b4ce8b','流程'],['#9daef4','Agent'],['#94d9ae','工具'],['#dcb16f','验证与反馈']].map(([color,label]) => `<span><i style="background:${color}"></i>${label}</span>`).join('');
  return `<div class="graph-viewport" tabindex="0" aria-label="工作流画布"><div class="graph-board">${wires}${nodes}${loop ? '<span class="edge-note" style="left:55%;top:85%">验证失败 · 反馈重试</span>' : ''}</div></div><div class="graph-footer"><div class="legend">${legend}</div><span>${config.nodes.length} 个节点 · ${config.nodes.reduce((total,n)=>total+n.deps.length,0)} 条依赖</span></div>`;
}

function inspector() {
  const node = config.nodes.find(item => item.id === selected) ?? config.nodes[0];
  const type = kinds[node.type], assignment = current?.assignments[node.id];
  return `<div class="panel-content"><div class="inspect-title"><span class="node-icon ${type.group}">${glyph(type.icon)}</span><div><h3>${h(node.name)}</h3><small>${h(type.name)}</small></div></div><p class="description">${h(node.note || '未填写节点说明。')}</p><div class="inspect-meta"><div><span>优先级</span><strong>${node.priority}</strong></div><div><span>运行状态</span>${status(current?.states[node.id])}</div><div><span>上游依赖</span><strong>${node.deps.length} 个节点</strong></div><div><span>${assignment ? '已分配' : '执行配置'}</span><strong>${h(assignment?.name ?? node.skill ?? (node.type==='verify' ? `重试上限 ${config.maxLoops}` : '默认'))}</strong></div></div><div class="actions" style="margin-top:12px">${button('配置节点','edit-node','adjust','','data-id="'+h(node.id)+'"')}${current?.outputs[node.id] !== undefined ? button('查看输出','node-output','file','','data-id="'+h(node.id)+'"') : ''}</div></div>`;
}
function events(result) {
  if (!result?.events.length) return '<div class="empty">运行后将在这里显示 Agent 分配、验证和反馈事件。</div>';
  return `<div class="events panel-content" aria-label="运行事件">${[...result.events].reverse().map(event => `<div class="event"><time>${time(event.time)}</time><i class="${event.level}"></i><div><strong>${h(event.title)}</strong>${event.info ? `<small>${h(event.info)}</small>` : ''}</div></div>`).join('')}</div>`;
}
function reportMarkup(result) {
  const report = result?.report;
  if (!report) return '<div class="empty">运行通过后可查看有效收入、异常记录与处置建议。</div>';
  return `<div class="panel-content"><div class="tags">${pill(report.verified ? '自动验证通过' : '人工复核放行',report.verified?'green':'amber')}${pill(`${report.baseline.rows} 条输入`)}${pill(`${report.baseline.count} 笔有效订单`)}${pill(`有效收入 ¥${money(report.baseline.sum)}`,'green')}${pill(`${report.baseline.findings.length} 项异常`,'amber')}</div><div class="report">${report.baseline.findings.map(finding => `<div><strong>${h(finding.label)} · ${h(finding.record)}</strong><p>${h(finding.recommendation)}</p><small>记录行 ${finding.row} · 规则 ${h(finding.rule)}</small></div>`).join('')}${report.reviews.filter(review => review.human).map(review => `<div><strong>人工复核意见</strong><p>${h(review.note)}</p></div>`).join('')}</div></div>`;
}
function workflowPage() {
  return intro(config.title,'编排 Agent、工具与验证节点，追踪每次调度和反馈修正。',`<div class="actions">${button('任务与数据','task','database')}${button('运行配置','options','adjust')}</div>`,'WORKFLOW STUDIO')+
    `<div class="metrics">${metric('活动 Agent',config.agents.filter(agent=>agent.active).length,'按技能、负载与反馈派工','bot')}${metric('工作流节点',config.nodes.length,`并发上限 ${config.strategy==='serial' ? 1 : config.concurrency}`,'graph')}${metric('反馈轮次',current?.loops ?? 0,`每次运行最多 ${config.maxLoops} 轮`,'loop')}${metric('运行状态',statusText[current?.status] ?? '待运行',current?.duration ? `耗时 ${elapsed(current.duration)}` : config.mode==='deepseek'?'DeepSeek 实时推理':'离线演示','pulse',true)}</div>`+
    `<div class="layout">${panel('工作流画布','graph',graph(),`<div class="actions">${button('定义','workflow-json','code','quiet')}${button('添加节点','add-node','plus')}</div>`)}<div class="side-stack">${panel('节点检查器','adjust',inspector())}${panel('执行事件','pulse',events(current),current ? status(current.status) : '')}</div></div>`+
    panel('审计报告','file',reportMarkup(current),current?.report ? button('导出报告','export-report','download') : '', 'workspace-bottom');
}
function agentsPage() {
  return intro('Agent 团队','配置角色、能力、并发容量与提示词。保存修改时会递增版本。',button('注册 Agent','agent-add','plus','primary'))+
    `<div class="grid-cards">${config.agents.map(agent => `<article class="card"><div class="inspect-title"><span class="node-icon agent">${glyph('bot')}</span><div><h2>${h(agent.name)}</h2><small>${h(agent.role)} · v${agent.version}</small></div></div><div class="tags">${pill(agent.active?'已启用':'已停用',agent.active?'green':'')}${agent.skills.map(skill=>pill(skill,'blue')).join('')}${pill(`容量 ${agent.capacity}`)}${pill(`适配分 ${agent.fit}`)}</div><p>${h(agent.prompt)}</p><small>工具 ${h(agent.tools.join('、') || '无')} · 反馈记忆 ${agent.memory?'启用':'关闭'}</small><div class="actions">${button('配置','agent-edit','adjust','',`data-id="${h(agent.id)}"`)}${button(agent.active?'停用':'启用','agent-toggle',null,'quiet',`data-id="${h(agent.id)}"`)}</div></article>`).join('')}</div>`;
}
function knowledgePage() {
  const docs = config.docs;
  return intro('知识库','管理审计规则，并预览当前任务可检索到的资料。',button('添加知识','doc-add','plus','primary'))+
    `<div class="split">${panel('审计资料','book',`<div class="panel-content"><div class="doc-list">${docs.map(doc=>`<div class="doc-row"><div><h3>${h(doc.title)}</h3><small>${h(doc.id)} · ${h(doc.tags)}</small></div>${button('查看','doc-edit','file','quiet',`data-id="${h(doc.id)}"`)}</div>`).join('') || '当前知识库为空。'}</div></div>`)}${panel('检索预览','input',`<div class="panel-content"><form class="form" id="search-form"><label>关键词<input name="query" value="${h(config.task)}" required></label><div>${button('检索','search','book','primary','type="submit"')}</div></form><div id="search-results"></div></div>`)}</div>`;
}
function runsPage() {
  return intro('运行记录','查看每次运行的状态、调度版本、失败快照和任务配置。',button('调度对比','benchmark','pulse'))+
    (benchmark ? `<div class="alert">${h(benchmark)}</div>` : '') + panel('运行历史','clock',history.length ? `<div class="table-wrap"><table><thead><tr><th>运行 ID</th><th>时间</th><th>推理模式</th><th>状态</th><th>耗时</th><th>反馈</th><th>操作</th></tr></thead><tbody>${history.map(({run:r})=>`<tr><td>${h(r.id)}</td><td>${time(r.time)}</td><td>${r.mode==='deepseek'?'DeepSeek':'离线演示'}</td><td>${status(r.status)}</td><td>${elapsed(r.duration)}</td><td>${r.loops}</td><td>${button('详情','run-detail',null,'quiet',`data-id="${h(r.id)}"`)}</td></tr>`).join('')}</tbody></table></div>` : '<div class="empty">暂无运行记录。可从工作流编排页启动一次运行。</div>');
}
function settingsPage() {
  if (standaloneHtml) {
    return intro('模型设置','当前打开的是离线演示 HTML。')+
      panel('离线演示','settings','<div class="panel-content"><p>可直接运行预置工作流。要连接 DeepSeek，请解压 Windows 便携包，双击 LoomOps.exe，再打开「模型设置」。</p></div>');
  }
  return intro('模型设置','选择 DeepSeek 实时推理或内置的离线演示模式。')+
    `<div class="split">${panel('DeepSeek API','settings',`<div class="panel-content"><form class="form" id="settings-form"><label>运行模式<select name="mode"><option value="offline" ${config.mode==='offline'?'selected':''}>离线演示</option><option value="deepseek" ${config.mode==='deepseek'?'selected':''}>DeepSeek 实时推理</option></select></label><label>模型<select name="model"><option value="deepseek-flash" ${config.model==='deepseek-flash'?'selected':''}>DeepSeek Flash</option><option value="deepseek-v4-pro" ${config.model==='deepseek-v4-pro'?'selected':''}>DeepSeek V4 Pro</option></select></label><label>API Key<input name="key" type="password" autocomplete="off" placeholder="${storedKey?'已检测到服务端环境变量':'输入 DeepSeek API Key'}" value="${h(key)}"></label><small>此处输入的 Key 仅保留在当前标签页内存。也可在服务端设置 DEEPSEEK_API_KEY。</small><div class="actions">${button('保存设置','save-settings',null,'primary','type="submit"')}${button('测试连接','test-model','pulse','','type="button"')}</div><div id="model-test" aria-live="polite"></div></form></div>`)}${panel('推理与验证','shield',`<div class="panel-content"><p class="description">实时模式将任务描述、聚合统计、异常明细和相关规则发送给 DeepSeek。分析与复核 Agent 分别生成结构化结果，验证门在本地比对。API 调用失败时，运行会标记为失败。</p><div class="tags" style="margin-top:13px">${pill('JSON 输出')}${pill('基准比对')}${pill('反馈重试')}</div></div>`)}</div>`;
}

function render() {
  $('#crumb').textContent = pages[page][0];
  $('#nav').innerHTML = Object.entries(pages).filter(([name])=>name!=='settings').map(([name,[label,shape]])=>`<button class="nav-button ${page===name?'active':''}" data-page="${name}" ${page===name?'aria-current="page"':''}>${glyph(shape)}${label}</button>`).join('');
  $('#mode-label').innerHTML = config.mode==='deepseek' ? `DeepSeek 实时推理<small>${h(config.model)}</small>` : '离线演示<small>DeepSeek 可配置</small>';
  $('#top-run').innerHTML = controller ? `${glyph('stop')}停止运行` : `${glyph('play')}运行工作流`;
  const oldScroll = $('.graph-viewport')?.scrollLeft ?? 0;
  $('#view').innerHTML = ({workflow:workflowPage,agents:agentsPage,knowledge:knowledgePage,runs:runsPage,settings:settingsPage})[page]();
  if ($('.graph-viewport')) $('.graph-viewport').scrollLeft = oldScroll;
}
function navigate(next) {page=next; render(); window.scrollTo(0,0);}
function editable() {if (!controller) return true; toast('请等待当前运行结束后再修改配置。');return false;}
function modal(title, content, onSubmit, primary = '保存', more = '') {
  dialog.innerHTML = `<div class="panel-head"><div><h2>${h(title)}</h2></div>${button('关闭','close','close','quiet')}</div><div class="dialog-body">${onSubmit ? `<form class="form">${content}<div class="actions"><button class="btn primary" type="submit">${h(primary)}</button>${more}</div><div class="dialog-error" aria-live="polite"></div></form>` : content}</div>`;
  if (!dialog.open) dialog.showModal();
  if (onSubmit) dialog.querySelector('form').addEventListener('submit', async event => {
    event.preventDefault();
    try {await onSubmit(new FormData(event.currentTarget)); dialog.close(); render();}
    catch(error) {dialog.querySelector('.dialog-error').innerHTML = `<div class="alert">${h(error.message)}</div>`;}
  });
}
const field = (label,name,value,type='text',attrs='') => `<label>${label}<input name="${name}" type="${type}" value="${h(value)}" ${attrs}></label>`;
const area = (label,name,value,rows=4,cls='') => `<label>${label}<textarea name="${name}" class="${cls}" rows="${rows}" required>${h(value)}</textarea></label>`;
const check = (label,name,value) => `<label class="inline"><input name="${name}" type="checkbox" ${value?'checked':''}>${label}</label>`;
function download(name,data) {
  const url = URL.createObjectURL(new Blob([json(data)],{type:'application/json'}));
  const anchor = document.createElement('a'); anchor.href=url; anchor.download=name; anchor.click(); setTimeout(()=>URL.revokeObjectURL(url),1000);
}
function exportRun(entry) {download(`loomops-run-${entry.run.id}.json`,entry);}

function editTask() {
  modal('任务与数据',`${field('工作流名称','title',config.title,'text','required maxlength="80"')}${area('任务描述','task',config.task,2)}${area('订单 CSV','csv',config.csv,8,'code')}<label>导入 CSV<input id="csv-file" type="file" accept=".csv,text/csv"></label><small>必填列为 order_id、region、amount，支持最多 500 条记录。</small>`,data=>{
    parseCsv(data.get('csv'));
    if (!data.get('title').trim() || !data.get('task').trim() || data.get('task').length>2500) throw new Error('请输入有效名称和 2500 字以内的任务描述。');
    Object.assign(config,{title:data.get('title').trim(),task:data.get('task').trim(),csv:data.get('csv')}); persist();
  });
  $('#csv-file').addEventListener('change',async event=>{
    const file=event.target.files[0]; if (!file) return;
    if (file.size > 200000) return toast('CSV 需要在 200 KB 以内。');
    dialog.querySelector('[name=csv]').value = await file.text();
  });
}
function editNode(nodeId) {
  const found=config.nodes.find(node=>node.id===nodeId);
  const node=found ?? {id:`node-${id()}`,name:'',type:'agent',skill:'分析',deps:[],x:50,y:87,priority:50,note:''};
  const body = `<div class="field-grid">${field('节点名称','name',node.name,'text','required maxlength="50"')}${field('节点 ID','id',node.id,'text',found?'readonly':'required pattern="[a-z][a-z0-9_-]{0,27}"')}</div><div class="field-grid"><label>执行类型<select name="type">${Object.entries(kinds).map(([type,value])=>`<option value="${type}" ${type===node.type?'selected':''}>${value.name}</option>`).join('')}</select></label>${field('任务优先级','priority',node.priority,'number','required min="0" max="100"')}</div>${field('上游节点 ID（逗号分隔）','deps',node.deps.join(', '))}${field('Agent 所需技能','skill',node.skill ?? '')}${field('子工作流名称','flow',node.flow ?? '')}<div class="field-grid">${field('横坐标 %','x',node.x,'number','required min="8" max="92"')}${field('纵坐标 %','y',node.y,'number','required min="10" max="90"')}</div><div class="field-grid">${field('条件来源节点 ID','when',node.when?.node ?? '')}<label>条件结果<select name="passed"><option value="true">通过</option><option value="false" ${node.when?.passed===false?'selected':''}>未通过</option></select></label></div>${field('节点说明','note',node.note,'text','maxlength="180"')}`;
  modal(found?'配置节点':'添加节点',body,data=>{
    const values=Object.fromEntries(data), update={...values,name:values.name.trim(),skill:values.skill.trim(),deps:values.deps.split(/[,，]/).map(value=>value.trim()).filter(Boolean),x:Number(values.x),y:Number(values.y),priority:Number(values.priority)};
    delete update.passed;
    if (values.when.trim()) update.when={node:values.when.trim(),passed:values.passed==='true'};
    else delete update.when;
    if (update.type==='agent'&&!update.skill) throw new Error('Agent 节点须指定所需技能。');
    const nodes=found ? config.nodes.map(item=>item.id===node.id?update:item) : [...config.nodes,update];
    validateGraph(nodes,config.subflows); config.nodes=nodes; selected=update.id; current=null; persist();
  },'保存节点',found?button('删除节点','node-delete',null,'danger','type="button" data-id="'+h(node.id)+'"'):'');
}
function editAgent(agentId) {
  const existing=config.agents.find(agent=>agent.id===agentId);
  const agent=existing ?? {id:`agent-${id()}`,name:'',role:'',skills:[],fit:85,capacity:1,version:0,active:true,memory:true,tools:['数据扫描','规则检索'],prompt:''};
  modal(existing?'配置 Agent':'注册 Agent',`<div class="field-grid">${field('名称','name',agent.name,'text','required maxlength="50"')}${field('角色','role',agent.role,'text','required maxlength="40"')}</div>${field('技能（逗号分隔）','skills',agent.skills.join(', '),'text','required maxlength="100"')}<div class="field-grid">${field('能力适配分','fit',agent.fit,'number','required min="0" max="100"')}${field('并发容量','capacity',agent.capacity,'number','required min="1" max="8"')}</div>${area('角色提示词','prompt',agent.prompt)}${check('提供数据扫描工具','scan',agent.tools.includes('数据扫描'))}${check('提供知识检索工具','kb',agent.tools.includes('规则检索'))}${check('保留反馈所需的上一轮输出','memory',agent.memory)}`,data=>{
    const values=Object.fromEntries(data);
    const skills=[...new Set(values.skills.split(/[,，]/).map(skill=>skill.trim()).filter(Boolean))];
    if (!values.name.trim() || !values.role.trim() || !skills.length || !values.prompt.trim() || values.prompt.length>2000) throw new Error('请填写名称、角色、技能和 2000 字以内的提示词。');
    const update={...agent,name:values.name.trim(),role:values.role.trim(),skills,fit:Number(values.fit),capacity:Number(values.capacity),prompt:values.prompt.trim(),version:agent.version+1,memory:data.has('memory'),tools:[...(data.has('scan')?['数据扫描']:[]),...(data.has('kb')?['规则检索']:[])]};
    config.agents=existing ? config.agents.map(item=>item.id===agent.id?update:item) : [...config.agents,update]; persist();
  });
}
function editDoc(docId) {
  const existing=config.docs.find(doc=>doc.id===docId), doc=existing ?? {id:'R-'+id(),title:'',tags:'',text:''};
  modal(existing?'编辑审计规则':'添加审计规则',`${field('规则 ID','id',doc.id,'text','required pattern="[A-Za-z0-9_-]{1,40}"')}${field('标题','title',doc.title,'text','required maxlength="70"')}${field('检索词（空格分隔）','tags',doc.tags,'text','required maxlength="160"')}${area('规则内容','text',doc.text,6)}`,data=>{
    const next=Object.fromEntries(data);
    if (!next.title.trim() || !next.tags.trim() || !next.text.trim() || next.text.length>2000) throw new Error('请填写标题、检索词和 2000 字以内的规则内容。');
    if (config.docs.some(item=>item.id===next.id && item.id!==docId)) throw new Error('规则 ID 已存在。');
    config.docs=existing ? config.docs.map(item=>item.id===docId?next:item) : [...config.docs,next];persist();
  },'保存规则',existing?button('删除规则','doc-delete',null,'danger',`type="button" data-id="${h(docId)}"`):'');
}
function runOptions() {
  modal('运行配置',`<label>调度策略<select name="strategy"><option value="parallel">优先级动态并行</option><option value="serial" ${config.strategy==='serial'?'selected':''}>串行基线</option></select></label><div class="field-grid">${field('并发上限','concurrency',config.concurrency,'number','required min="1" max="8"')}${field('反馈重试上限','maxLoops',config.maxLoops,'number','required min="0" max="5"')}</div>${check('离线首次分析故意遗漏一条证据','inject',config.inject)}${check('发布报告前要求人工复核','human',config.human)}`,data=>{
    Object.assign(config,{strategy:data.get('strategy'),concurrency:Number(data.get('concurrency')),maxLoops:Number(data.get('maxLoops')),inject:data.has('inject'),human:data.has('human')});persist();
  });
}
function workflowJson() {
  modal('工作流 JSON 定义',`${area('节点与子工作流', 'value',json({nodes:config.nodes,subflows:config.subflows}),17,'code')}<small>子工作流以名称映射到节点数组，subflow 节点通过 flow 字段引用。条件分支在 when 中填写 node 与 passed。</small>`,data=>{
    const {nodes,subflows={}}=JSON.parse(data.get('value'));
    if (!subflows || Array.isArray(subflows) || typeof subflows!=='object') throw new Error('subflows 须为对象。');
    validateGraph(nodes,subflows); Object.assign(config,{nodes,subflows});selected=nodes[0].id;current=null;persist();
  },'应用定义',button('导出定义','export-graph','download','quiet','type="button"'));
}

function checkedKey(value) {
  const token = value.trim();
  if (token && (token.length > 512 || !/^sk-[A-Za-z0-9_-]+$/.test(token))) {
    throw new Error('API Key 格式无效。请只粘贴 sk- 开头的密钥，不要附带说明文字、引号或内嵌空格。');
  }
  return token;
}

async function api(payload, signal, apiKey = key) {
  const token = checkedKey(apiKey);
  if (!token && !storedKey) throw new Error('请输入 DeepSeek API Key。');
  let response;
  try {response=await fetch('/api/deepseek',{method:'POST',headers:{'content-type':'application/json',...(token?{'x-deepseek-key':token}:{})},body:JSON.stringify(payload),signal});}
  catch(error) {if (signal?.aborted) throw error; throw new Error('无法连接模型代理。请检查应用是否通过本地服务或已部署站点打开。');}
  const body=await response.json().catch(()=>null);
  if (!response.ok || !body?.result) throw new Error(body?.error ?? `模型代理返回 HTTP ${response.status}。`);
  return body;
}
function requestReview({node,validation,baseline}, signal) {
  return new Promise(resolve=>{
    let settled=false;
    const finish=result=>{if(settled)return; settled=true;signal.removeEventListener('abort',abort);dialog.removeEventListener('cancel',cancel);dialog.close();resolve(result);};
    const abort=()=>finish({passed:false,note:'运行已停止'});
    const cancel=event=>event.preventDefault();
    signal.addEventListener('abort',abort,{once:true});
    dialog.addEventListener('cancel',cancel);
    dialog.innerHTML=`<div class="panel-head"><div>${glyph('user')}<h2>${h(node)} · 等待决定</h2></div></div><div class="dialog-body"><div class="tags">${pill(`基准收入 ¥${money(baseline.sum)}`)}${pill(`${baseline.findings.length} 项异常`)}</div><div class="report">${validation.flatMap(item=>item.checks).map(item=>`<div><strong>${h(item.node)} · ${item.passed?'通过':'未通过'}</strong><p>${h(item.issues.join('；'))}</p></div>`).join('')}</div><form class="form" style="margin-top:12px">${area('复核意见','note','',2)}<div class="actions"><button type="submit" class="btn primary" value="approve">批准发布</button><button type="submit" class="btn danger" value="reject">拒绝发布</button><button type="button" class="btn" id="review-stop">停止运行</button></div></form></div>`;
    dialog.querySelector('form').onsubmit=event=>{event.preventDefault();const note=dialog.querySelector('textarea').value.trim();if(note)finish({passed:event.submitter?.value==='approve',note});};
    $('#review-stop').onclick=()=>controller?.abort();
    if (!dialog.open) dialog.showModal();
    if (signal.aborted) abort();
  });
}
async function start(snapshot = config) {
  if (controller) {controller.abort();return;}
  if (standaloneHtml) snapshot={...snapshot,mode:'offline'};
  if (snapshot.mode==='deepseek'&&!key&&!storedKey) {navigate('settings');toast('请先设置 DeepSeek API Key。');return;}
  const archived=clone(snapshot), runId=id();
  controller=new AbortController(); current=null; navigate('workflow');
  try {
    const result=await run(archived,{id:runId,signal:controller.signal,pace:archived.mode==='offline'?190:0,callModel:api,requestReview,emit:state=>{current=state;if(page==='workflow')render();}});
    current=result;
    history=[{run:result,config:archived},...history].slice(0,12);persistHistory();
    toast(result.error ?? `运行 ${runId} · ${statusText[result.status]}`);
  } catch(error) {toast(error.message);}
  finally {controller=null;render();}
}
async function compare() {
  const scenario={...clone(defaults),inject:false};
  benchmark='正在运行相同数据下的串行与并行测试…'; render();
  try {
    const samples={serial:[],parallel:[]};
    for(let i=0;i<3;i++) {
      for(const strategy of ['serial','parallel']) {
        const result=await run({...scenario,strategy},{pace:45,id:`bench-${i}`});
        if(result.status!=='succeeded') throw new Error(result.error??'对比用例未通过');
        samples[strategy].push(result.duration);
      }
    }
    const median=values=>[...values].sort((a,b)=>a-b)[1];
    const serial=median(samples.serial), parallel=median(samples.parallel);
    benchmark=`样例订单 · 各 3 次 · 每节点加入 45 ms 固定等待 · 串行中位 ${serial} ms · 并行中位 ${parallel} ms · 加速 ${(serial/parallel).toFixed(2)} 倍 · 6/6 通过`;
  } catch(error) {benchmark=error.message;}
  if(page==='runs')render();
}
function detail(entry) {
  const {run:r}=entry;
  modal(`运行 ${r.id}`,`<div class="tags">${status(r.status)}${pill(r.mode==='deepseek'?'DeepSeek':'离线演示')}${pill(elapsed(r.duration))}${pill(`${r.calls} 次模型调用`)}${pill(`${r.tokens} tokens`)}</div><div class="actions" style="margin-top:12px">${button('导出快照','export-run','download','',`data-id="${h(r.id)}"`)}${button('恢复并重跑','replay','loop','',`data-id="${h(r.id)}"`)}</div>${r.error?`<p class="description failed-text">${h(r.error)}</p>`:''}<details open><summary>事件日志</summary>${events(r)}</details><details><summary>节点输出与反馈快照</summary><pre>${h(json({assignments:r.assignments,outputs:r.outputs,revision:r.revision}))}</pre></details>`);
}

const actionHandlers = {
  close:()=>dialog.close(), task:()=>editable()&&editTask(), options:()=>editable()&&runOptions(),
  'select-node':nodeId=>{selected=nodeId;render();}, 'edit-node':nodeId=>editable()&&editNode(nodeId), 'add-node':()=>editable()&&editNode(),
  'workflow-json':()=>editable()&&workflowJson(), 'export-graph':()=>download('loomops-workflow.json',{nodes:config.nodes,subflows:config.subflows}),
  'node-output':nodeId=>modal('节点输出',`<pre>${h(json(current.outputs[nodeId]))}</pre>`),
  'node-delete':nodeId=>{
    const nodes=config.nodes.filter(node=>node.id!==nodeId);
    try {validateGraph(nodes,config.subflows);config.nodes=nodes;selected=nodes[0].id;current=null;persist();dialog.close();render();}
    catch(error){toast(error.message);}
  },
  'agent-add':()=>editable()&&editAgent(), 'agent-edit':agentId=>editable()&&editAgent(agentId),
  'agent-toggle':agentId=>{if(!editable())return;const agent=config.agents.find(item=>item.id===agentId);agent.active=!agent.active;agent.version++;persist();render();},
  'doc-add':()=>editable()&&editDoc(), 'doc-edit':docId=>editable()&&editDoc(docId),
  'doc-delete':docId=>{config.docs=config.docs.filter(item=>item.id!==docId);persist();dialog.close();render();},
  'export-report':()=>download(`loomops-report-${current.id}.json`,current.report),
  'run-detail':runId=>detail(history.find(item=>item.run.id===runId)),
  'export-run':runId=>exportRun(history.find(item=>item.run.id===runId)),
  replay:runId=>{if(!editable())return;config=clone(history.find(item=>item.run.id===runId).config);persist();dialog.close();start();},
  benchmark:compare,
  'test-model':async()=>{
    const form=$('#settings-form'), message=$('#model-test'), values=new FormData(form);
    const control=form.querySelector('[data-action="test-model"]');
    control.disabled=true;
    message.className='';
    message.textContent='正在连接 DeepSeek…';
    try {const result=await api({test:true,model:values.get('model')},undefined,values.get('key').trim());message.textContent=`连接成功 · ${result.model ?? values.get('model')}`;message.className='passed';}
    catch(error){message.textContent=error.message;message.className='failed-text';}
    finally {control.disabled=false;}
  }
};
document.addEventListener('click',event=>{
  const element=event.target.closest('button'); if(!element)return;
  if(element.dataset.page) return navigate(element.dataset.page);
  const action=element.dataset.action;
  if(actionHandlers[action]) {event.preventDefault();actionHandlers[action](element.dataset.id);}
});
document.addEventListener('submit',event=>{
  if(event.target.id==='settings-form') {
    event.preventDefault(); if(!editable())return;
    const values=new FormData(event.target);
    try {key=checkedKey(values.get('key'));}
    catch(error) {const message=$('#model-test');message.textContent=error.message;message.className='failed-text';return;}
    config.mode=values.get('mode');config.model=values.get('model');persist();render();toast('模型设置已保存。');
  }
  if(event.target.id==='search-form') {
    event.preventDefault();const values=new FormData(event.target), result=retrieve(config.docs,values.get('query'),[]);
    $('#search-results').innerHTML=`<div class="doc-list">${result.map(doc=>`<div class="doc-row"><div><h3>${h(doc.title)} · ${h(doc.id)}</h3><small>${h(doc.text)}</small></div></div>`).join('')||'<p class="description">未匹配资料，可尝试「订单」「负值」或「区域」。</p>'}</div>`;
  }
});
$('#top-settings').onclick=()=>navigate('settings');
$('#top-run').onclick=()=>start();
document.querySelectorAll('[data-icon]').forEach(element=>{element.innerHTML=icon(element.dataset.icon);});
render();
if (!standaloneHtml) {
  fetch('/api/config').then(response=>response.json()).then(data=>{
    storedKey=Boolean(data.serverKey);
    if (!storedKey) return;
    if (!savedConfig.mode&&!controller&&!read('loomops-workflow-v1',{}).mode) config.mode='deepseek';
    if ((page==='workflow'&&!controller)||(page==='settings'&&!$('#settings-form').contains(document.activeElement))) render();
  }).catch(()=>{});
}
