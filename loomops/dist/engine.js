(function (root) {
  'use strict';

  const clone = value => JSON.parse(JSON.stringify(value));
  const wait = ms => new Promise(resolve => setTimeout(resolve, ms));
  const kinds = {
    input: {name:'任务输入', icon:'input', group:'start'},
    data: {name:'数据工具', icon:'database', group:'tool'},
    kb: {name:'知识检索', icon:'book', group:'tool'},
    agent: {name:'Agent 推理', icon:'bot', group:'agent'},
    verify: {name:'结果验证', icon:'shield', group:'check'},
    review: {name:'人工复核', icon:'user', group:'review'},
    report: {name:'审计输出', icon:'file', group:'start'},
    subflow: {name:'子工作流', icon:'layers', group:'tool'}
  };

  const defaultNodes = [
    {id:'input', name:'任务输入', type:'input', deps:[], x:10, y:39, priority:100, note:'读取任务描述与待检查的经营订单。'},
    {id:'data', name:'数据扫描', type:'data', deps:['input'], x:30, y:23, priority:85, note:'计算交易额、交易数和异常记录。'},
    {id:'policy', name:'规则检索', type:'kb', deps:['input'], x:30, y:57, priority:70, note:'从本地知识库检索相关审计规则。'},
    {id:'analysis', name:'异常分析', type:'agent', skill:'分析', deps:['data','policy'], x:50, y:23, priority:82, note:'根据扫描结果识别风险并提出处置建议。'},
    {id:'cross', name:'独立复核', type:'agent', skill:'复核', deps:['data','policy'], x:50, y:57, priority:76, note:'独立评估同一份证据，供验证节点交叉核对。'},
    {id:'verify', name:'验证门', type:'verify', deps:['analysis','cross'], x:70, y:39, priority:95, note:'校验汇总、异常集合和证据引用。校验失败时反馈并重跑相关节点。'},
    {id:'review', name:'人工复核', type:'review', deps:['verify'], x:70, y:78, priority:90, note:'达到重试上限或启用人工复核时暂停等待决定。'},
    {id:'report', name:'生成报告', type:'report', deps:['review'], x:90, y:39, priority:60, note:'仅发布已自动通过的结果或人工审核记录。'}
  ];

  const defaultAgents = [
    {id:'analyst', name:'数据分析师', role:'分析', skills:['分析'], fit:100, capacity:2, version:1, active:true, memory:true, tools:['数据扫描','规则检索'], prompt:'识别订单质量异常，给出有记录依据的可执行处置建议。'},
    {id:'reviewer', name:'质量复核员', role:'复核', skills:['复核'], fit:100, capacity:1, version:1, active:true, memory:true, tools:['数据扫描','规则检索'], prompt:'独立核对统计口径和异常集合，逐条检查规则依据并提出处置建议。'},
    {id:'consultant', name:'审计顾问', role:'候补', skills:['分析','复核'], fit:80, capacity:1, version:1, active:true, memory:true, tools:['数据扫描','规则检索'], prompt:'基于证据完成质量审计并提出可操作措施。'}
  ];

  const defaultDocs = [
    {id:'R-001', title:'订单主键唯一性', text:'订单号应唯一。保留同一订单号第一次出现的有效记录，后续记录应标记为重复。', tags:'重复 duplicate 订单 主键'},
    {id:'R-002', title:'交易金额检查', text:'交易金额应为非负数。负数记录进入人工核对，不能计入有效经营收入。', tags:'金额 负值 negative_amount 交易'},
    {id:'R-003', title:'区域完整性检查', text:'区域为空时需要补全主数据，允许保留该订单的有效金额用于整体收入汇总。', tags:'区域 缺失 missing_region 主数据'}
  ];

  const sample = `order_id,region,amount
ORD-1001,华东,18200
ORD-1002,华南,9650
ORD-1003,华北,12800
ORD-1003,华北,12800
ORD-1004,华东,-250
ORD-1005,,7600
ORD-1006,西南,13800
ORD-1007,华南,11200`;

  const defaults = {
    nodes:defaultNodes, agents:defaultAgents, docs:defaultDocs, subflows:{},
    title:'经营数据质量审计', task:'检查经营订单中的重复、负金额和缺失区域，核对有效收入并生成审计建议。',
    csv:sample, concurrency:3, maxLoops:2, inject:true, human:false, strategy:'parallel', mode:'offline', model:'deepseek-flash'
  };

  function parseCsv(text) {
    if (typeof text !== 'string' || text.length > 200000) throw new Error('CSV 需要是 200 KB 以内的文本。');
    const cells = [];
    let row = [], field = '', quoted = false;
    const source = text.replace(/^\uFEFF/, '').replace(/\r\n?/g, '\n');
    for (let i = 0; i <= source.length; i++) {
      const char = source[i];
      if (quoted) {
        if (char === '"' && source[i+1] === '"') {field += '"'; i++;}
        else if (char === '"') quoted = false;
        else if (char === undefined) throw new Error('CSV 中存在未闭合的引号。');
        else field += char;
      } else if (char === '"' && field === '') quoted = true;
      else if (char === ',') {row.push(field.trim()); field = '';}
      else if (char === '\n' || char === undefined) {
        row.push(field.trim());
        if (row.some(Boolean) || row.length > 1) cells.push(row);
        row = []; field = '';
      } else field += char;
    }
    const header = cells.shift() ?? [];
    const columns = ['order_id','region','amount'].map(name => header.indexOf(name));
    if (columns.includes(-1) || new Set(header).size !== header.length) throw new Error('CSV 需要包含唯一的 order_id、region、amount 三列。');
    if (!cells.length || cells.length > 500) throw new Error('请输入 1 至 500 行订单。');
    return cells.map((values, index) => {
      const [id, region, amount] = columns.map(i => values[i]);
      const number = Number(amount);
      if (values.length !== header.length || !id || !/^-?\d+(?:\.\d{1,2})?$/.test(amount) || !Number.isFinite(number) || Math.abs(number) > 1e9) {
        throw new Error(`第 ${index+2} 行的订单号、金额或列数无效。`);
      }
      return {row:index+2, id, region, cents:Math.round(number*100)};
    });
  }

  const rules = {
    duplicate:{rule:'R-001', label:'重复订单', recommendation:'核对上游导入批次，对同一订单号去重。'},
    negative_amount:{rule:'R-002', label:'负金额', recommendation:'核对退款或冲销凭证，确认是否应纳入专用流水。'},
    missing_region:{rule:'R-003', label:'区域缺失', recommendation:'匹配订单主数据并回填归属区域。'}
  };

  function scan(rows) {
    const orderIds = new Set(), findings = [];
    let sum = 0, count = 0;
    for (const row of rows) {
      const duplicate = orderIds.has(row.id);
      const types = [];
      if (duplicate) types.push('duplicate');
      if (row.cents < 0) types.push('negative_amount');
      if (!row.region) types.push('missing_region');
      if (!duplicate && row.cents >= 0) {sum += row.cents; count++; orderIds.add(row.id);}
      for (const type of types) findings.push({id:`${row.row}:${type}`, record:row.id, row:row.row, type, ...rules[type]});
    }
    return {rows:rows.length, count, sum, findings};
  }

  function retrieve(docs, task, findings) {
    const required = new Set(findings.map(finding => finding.rule));
    return docs.map(doc => {
      const words = doc.tags.toLowerCase().split(/\s+/).filter(Boolean);
      const score = words.filter(word => task.toLowerCase().includes(word)).length + (required.has(doc.id) ? 100 : 0);
      return {...doc, score};
    }).filter(doc => doc.score > 0).sort((a,b) => b.score-a.score || a.id.localeCompare(b.id)).slice(0,8);
  }

  function validateGraph(nodes, subflows = {}, stack = []) {
    if (!Array.isArray(nodes) || !nodes.length || nodes.length > 40) throw new Error('工作流须包含 1 至 40 个节点。');
    const byId = new Map();
    for (const node of nodes) {
      if (!node || !/^[a-z][a-z0-9_-]{0,27}$/.test(node.id) || byId.has(node.id) || !Object.hasOwn(kinds,node.type) || typeof node.name !== 'string' || !node.name.trim()) {
        throw new Error('节点 ID 须唯一，且节点类型与名称有效。');
      }
      if (!Array.isArray(node.deps) || new Set(node.deps).size !== node.deps.length || ![node.x,node.y,node.priority].every(Number.isFinite) || node.x < 8 || node.x > 92 || node.y < 10 || node.y > 90) throw new Error(`节点 ${node.id} 的依赖、优先级或坐标无效。`);
      byId.set(node.id,node);
    }
    const visiting = new Set(), done = new Set();
    function visit(id) {
      if (visiting.has(id)) throw new Error(`依赖形成死循环：${id}。请使用验证门的重试机制。`);
      if (done.has(id)) return;
      const node = byId.get(id);
      if (!node) throw new Error(`找不到依赖节点 ${id}。`);
      visiting.add(id);
      for (const dep of node.deps) visit(dep);
      if (node.when && (!node.deps.includes(node.when.node) || typeof node.when.passed !== 'boolean' || !['verify','review'].includes(byId.get(node.when.node)?.type))) throw new Error(`节点 ${id} 的条件须引用直接依赖的验证门或人工复核。`);
      if (node.type === 'subflow') {
        if (!Object.hasOwn(subflows,node.flow) || stack.includes(node.flow) || stack.length >= 3) throw new Error(`子工作流 ${node.flow || '(未指定)'} 不存在、循环引用或超过三层。`);
        validateGraph(subflows[node.flow],subflows,[...stack,node.flow]);
      }
      visiting.delete(id); done.add(id);
    }
    for (const node of nodes) visit(node.id);
    return byId;
  }

  function ancestors(node, byId) {
    const result = new Set();
    function collect(id) {
      if (result.has(id)) return;
      result.add(id);
      byId.get(id).deps.forEach(collect);
    }
    node.deps.forEach(collect);
    return result;
  }

  function verify(seen, baseline, docs) {
    const failures = {}, checks = [];
    const knowledge = new Set(docs.map(doc => doc.id));
    const expected = new Map(baseline.findings.map(finding => [finding.id, finding.rule]));
    for (const [nodeId, result] of seen) {
      const issues = [];
      if (!Number.isSafeInteger(result.sum) || result.sum !== baseline.sum || result.count !== baseline.count) issues.push(`收入或笔数不符，基准 ${baseline.sum} 分 / ${baseline.count} 笔`);
      const claims = Array.isArray(result.findings) ? result.findings : [];
      const ids = new Set(claims.map(claim => claim?.id));
      if (ids.size !== claims.length || ids.size !== expected.size || [...ids].some(id => !expected.has(id))) issues.push('异常集合不符或存在重复异常');
      for (const claim of claims) {
        const expectedRule = expected.get(claim?.id);
        if (!claim || expectedRule !== claim.evidence || !knowledge.has(claim.evidence)) {
          const ruleDetail = knowledge.has(expectedRule) ? `，应引用 ${expectedRule}` : '';
          issues.push(`${claim?.id ?? '未知异常'} 缺失有效证据引用${ruleDetail}`);
        }
        if (typeof claim?.recommendation !== 'string' || !claim.recommendation.trim()) issues.push('缺失处置建议');
      }
      checks.push({node:nodeId, passed:issues.length === 0, issues:[...new Set(issues)]});
      if (issues.length) failures[nodeId] = [...new Set(issues)];
    }
    const passed = checks.length > 0 && Object.keys(failures).length === 0;
    return {passed, failures, checks, message:passed ? `${checks.length} 个 Agent 的结构化结果与基准一致` : checks.length ? '发现需修正的结果' : '未找到可验证的 Agent 结果'};
  }

  function chooseAgent(agents, skill, load, previous) {
    return agents.filter(agent => agent.active && agent.skills.includes(skill) && (load.get(agent.id) ?? 0) < agent.capacity)
      .map(agent => ({agent, score:agent.fit - 60*(load.get(agent.id) ?? 0)/agent.capacity - (agent.id === previous ? 35 : 0)}))
      .sort((a,b) => b.score-a.score || a.agent.id.localeCompare(b.agent.id))[0];
  }

  function offlineResult(baseline, docs, inject) {
    const ids = new Set(docs.map(doc => doc.id));
    const findings = baseline.findings.map(finding => ({id:finding.id, evidence:ids.has(finding.rule) ? finding.rule : '', recommendation:finding.recommendation}));
    if (inject && findings.length) findings[0].evidence = '';
    return {sum:baseline.sum, count:baseline.count, findings, summary:'根据已检索的规则与订单扫描结果生成处置建议。'};
  }

  async function run(input, options = {}) {
    const {signal, emit = () => {}, callModel, requestReview = async () => ({passed:false, note:'没有复核人'}), pace = 0} = options;
    const config = clone(input), rows = parseCsv(config.csv), baseline = scan(rows);
    validateGraph(config.nodes,config.subflows);
    const runState = {id:options.id, time:Date.now(), mode:config.mode, strategy:config.strategy, status:'running', loops:0, calls:0, tokens:0, events:[], states:{}, outputs:{}, assignments:{}, revision:[]};
    const start = Date.now(), load = new Map(), feedback = new Map(), attempts = new Map(), outputs = Object.create(null);
    const cap = config.strategy === 'serial' ? 1 : config.concurrency;
    if (!Number.isInteger(cap) || cap < 1 || cap > 8 || !Number.isInteger(config.maxLoops) || config.maxLoops < 0 || config.maxLoops > 5) throw new Error('并发上限或重试次数无效。');
    const push = (title, info = '', level = 'ok') => {
      runState.events.push({time:Date.now(),title,info,level}); emit(runState);
    };
    function checkAbort() { if (signal?.aborted) throw new Error('运行已停止'); }
    async function executeGraph(nodes, prefix = '', inheritedDocs = []) {
      const byId = validateGraph(nodes,config.subflows), complete = new Set(), running = new Map(), local = Object.create(null);
      const critical = new Map();
      function depth(id) {
        if (!critical.has(id)) critical.set(id,Math.max(0,...nodes.filter(n => n.deps.includes(id)).map(n => 1+depth(n.id))));
        return critical.get(id);
      }
      const ordered = [...nodes].sort((a,b) => (b.priority + 10*depth(b.id))-(a.priority + 10*depth(a.id)));
      for (const node of nodes) runState.states[prefix+node.id] = 'idle';

      async function execute(node, selected) {
        const key = prefix+node.id, upstream = ancestors(node,byId);
        const docs = [...upstream].filter(id => byId.get(id).type === 'kb').flatMap(id => local[id] ?? []);
        const knowledge = [...new Map([...inheritedDocs,...docs].map(doc => [doc.id,doc])).values()];
        const gate = [...upstream].filter(id => ['verify','review'].includes(byId.get(id).type)).map(id => local[id]).filter(Boolean);
        if (pace) await wait(pace);
        checkAbort();
        switch (node.type) {
          case 'input': return {task:config.task, rows:rows.length};
          case 'data': return baseline;
          case 'kb': return retrieve(config.docs,config.task,baseline.findings);
          case 'subflow': return executeGraph(config.subflows[node.flow],`${key}/`,knowledge);
          case 'agent': {
            const {agent} = selected;
            const attempt = (attempts.get(key) ?? 0)+1;
            attempts.set(key,attempt);
            const availableRules = new Set(knowledge.map(doc => doc.id));
            const findings = baseline.findings.map(({id, record, row, type, rule}) => ({id,record,row,type,ruleHint:availableRules.has(rule) ? rule : null}));
            const correction = feedback.get(key) ?? [];
            if (config.mode === 'offline') return offlineResult(baseline,knowledge,config.inject && node.skill === '分析' && attempt === 1);
            if (!callModel) throw new Error('未配置 DeepSeek 请求处理器。');
            const toolContext = {
              ...(agent.tools.includes('数据扫描') ? {baseline:{sum:baseline.sum,count:baseline.count,findings}} : {}),
              ...(agent.tools.includes('规则检索') ? {knowledge:knowledge.map(({id,title,text,tags}) => ({id,title,text,tags}))} : {})
            };
            const payload = {model:config.model, agent:{name:agent.name, prompt:agent.prompt}, task:config.task, context:toolContext,
              feedback:correction, previous:agent.memory && correction.length ? outputs[key] : undefined, attempt};
            runState.calls++;
            const response = await callModel(payload,signal);
            runState.tokens += Number(response.usage?.total_tokens ?? 0) || 0;
            return response.result;
          }
          case 'verify': return verify([...upstream].filter(id => byId.get(id).type === 'agent' && local[id]).map(id => [id,local[id]]),baseline,knowledge);
          case 'review': {
            const validation = gate.filter(item => Array.isArray(item.checks));
            const invalid = validation.some(item => !item.passed);
            if (!config.human && !invalid) return {passed:validation.length > 0, human:false, override:false,note:'自动验证通过'};
            runState.states[key] = 'review';
            runState.status = 'review';
            push('等待人工复核',invalid ? '自动验证仍有未解决问题' : '工作流启用了人工审核','warn');
            const review = await requestReview({node:node.name,validation,baseline},signal);
            checkAbort();
            runState.status = 'running';
            return {...review,human:true,override:invalid && review.passed};
          }
          case 'report': {
            if (!gate.length) throw new Error('报告节点需要验证门或人工复核作为上游。');
            const reviews = gate.filter(item => Object.hasOwn(item,'human'));
            if (reviews.some(item => !item.passed) || (gate.some(item => !item.passed) && !reviews.some(item => item.override))) return {blocked:true};
            const verified = gate.filter(item => Array.isArray(item.checks)).every(item => item.passed);
            const findings = baseline.findings.map(finding => {
              const suggestions = verified ? [...upstream].map(id => local[id]?.findings?.find?.(claim => claim.id === finding.id && claim.evidence === finding.rule)).filter(Boolean) : [];
              return {...finding, recommendation:suggestions[0]?.recommendation ?? finding.recommendation};
            });
            return {baseline:{...baseline,findings}, evidence:knowledge.map(({id,title}) => ({id,title})), verified, reviews, mode:config.mode};
          }
        }
      }

      while (complete.size < nodes.length || running.size) {
        checkAbort();
        for (const node of ordered) {
          if (running.size >= cap) break;
          if (nodes.some(item => running.has(item.id) && ['subflow','review'].includes(item.type))) break;
          const key = prefix+node.id;
          if (complete.has(node.id) || running.has(node.id) || !node.deps.every(id => complete.has(id))) continue;
          if (running.size && ['subflow','review'].includes(node.type)) continue;
          if (node.when && local[node.when.node]?.passed !== node.when.passed) {
            runState.states[key] = 'skipped'; complete.add(node.id); push(`${node.name} · 条件跳过`); continue;
          }
          let selected;
          if (node.type === 'agent') {
            selected = chooseAgent(config.agents,node.skill,load,feedback.has(key) ? runState.assignments[key]?.id : undefined);
            if (!selected) {
              if (config.agents.some(agent => agent.active && agent.skills.includes(node.skill)) && running.size) continue;
              throw new Error(`缺少具备「${node.skill}」技能且可用的 Agent。`);
            }
            const {agent,score} = selected;
            load.set(agent.id,(load.get(agent.id) ?? 0)+1);
            runState.assignments[key] = {id:agent.id, name:agent.name, version:agent.version, score:Math.round(score)};
          }
          runState.states[key] = 'running';
          push(`${node.name} · 开始`, selected ? `${selected.agent.name} v${selected.agent.version} · 调度得分 ${Math.round(selected.score)}` : `${kinds[node.type].name} · 优先级 ${node.priority}`);
          running.set(node.id,execute(node,selected).then(value => ({node,value}),error => ({node,error})).finally(() => {
            if (selected) load.set(selected.agent.id,load.get(selected.agent.id)-1);
          }));
          if (['subflow','review'].includes(node.type)) break;
        }
        if (!running.size) {
          if (complete.size === nodes.length) break;
          if (ordered.some(node => !complete.has(node.id) && node.deps.every(id => complete.has(id)))) continue;
          throw new Error('存在无法调度的节点。');
        }
        const {node,value,error} = await Promise.race(running.values());
        running.delete(node.id);
        const key = prefix+node.id;
        if (error) {runState.states[key] = 'failed'; await Promise.all(running.values()); throw error;}
        outputs[key] = local[node.id] = value;
        runState.outputs = outputs;
        complete.add(node.id);
        if (node.type === 'verify' && !value.passed) {
          runState.states[key] = 'warning';
          const problems = Object.entries(value.failures);
          push(`${node.name} · 未通过`,problems.flatMap(([,issues]) => issues).join('；') || value.message,'warn');
          if (problems.length && runState.loops < config.maxLoops) {
            runState.loops++;
            runState.revision.push({round:runState.loops, gate:key, failures:clone(value.failures), before:Object.fromEntries(problems.map(([id]) => [prefix+id,clone(local[id])]))});
            for (const [id,issues] of problems) feedback.set(prefix+id,issues);
            const invalidated = new Set(problems.map(([id]) => id));
            for (const item of nodes) if ([...ancestors(item,byId)].some(id => invalidated.has(id))) invalidated.add(item.id);
            for (const id of invalidated) {
              if (running.has(id)) {await running.get(id); running.delete(id);}
              complete.delete(id);
              runState.states[prefix+id] = 'idle';
              delete local[id];
            }
            push(`反馈修正 · 第 ${runState.loops} 轮`,`回退 ${invalidated.size} 个节点，重新分配 ${problems.length} 个 Agent 任务`,'warn');
          }
        } else {
          const blocked = value?.blocked || (node.type === 'review' && !value?.passed);
          runState.states[key] = blocked ? 'warning' : 'done';
          push(`${node.name} · ${blocked ? '未放行' : '完成'}`,value?.message ?? (node.type === 'kb' ? `命中 ${value.length} 条规则` : value?.note ?? ''),blocked ? 'warn' : 'ok');
        }
      }
      return local;
    }

    push('工作流已启动',config.mode === 'deepseek' ? `DeepSeek · ${config.model}` : '离线演示 · 确定性模拟');
    try {
      const final = await executeGraph(config.nodes);
      const report = config.nodes.filter(node => node.type === 'report').map(node => final[node.id]).find(output => output && !output.blocked);
      runState.report = report ?? null;
      const declaredReports = config.nodes.some(node => node.type === 'report');
      const unresolved = config.nodes.some(node => ['verify','review'].includes(node.type) && final[node.id]?.passed === false);
      runState.status = (declaredReports ? !report : unresolved) ? 'blocked' : 'succeeded';
      push(runState.status === 'succeeded' ? '工作流执行成功' : '工作流结束 · 报告未发布');
    } catch (error) {
      runState.status = signal?.aborted ? 'cancelled' : 'failed';
      runState.error = error.message;
      push(runState.status === 'cancelled' ? '运行已停止' : '工作流执行失败',error.message,'error');
    }
    runState.duration = Date.now()-start;
    return runState;
  }

  const api = {defaults,kinds,clone,parseCsv,scan,retrieve,validateGraph,chooseAgent,run};
  if (typeof module !== 'undefined') module.exports = api;
  else root.Loom = api;
})(globalThis);
