const assert = require('node:assert/strict');
const test = require('node:test');
const {defaults,clone,parseCsv,scan,validateGraph,chooseAgent,run} = require('./dist/engine');

test('CSV recognizes quoted fields and computes the independent audit baseline', () => {
  const report = scan(parseCsv(defaults.csv));
  assert.equal(report.sum,7325000);
  assert.equal(report.count,6);
  assert.deepEqual(report.findings.map(finding => finding.id),['5:duplicate','6:negative_amount','7:missing_region']);
  assert.equal(parseCsv('order_id,region,amount\r\n"A,1","华""东",0.09')[0].cents,9);
  assert.throws(()=>parseCsv('order_id,region,amount\na,x,NaN'));
});

test('offline gate detects an omitted citation, rolls back, and reassigns to a different Agent', async () => {
  const stages = [];
  const result = await run(clone(defaults),{id:'offline',emit: state => stages.push([...Object.values(state.states)])});
  assert.equal(result.status,'succeeded',result.error);
  assert.equal(result.loops,1);
  assert.equal(result.calls,0);
  assert.equal(result.report.verified,true);
  assert.equal(result.revision[0].before.analysis.findings[0].evidence,'');
  assert.equal(result.assignments.analysis.id,'consultant');
  assert.equal(result.events.filter(event=>event.title==='独立复核 · 开始').length,1);
  assert.ok(stages.some(states=>states.filter(value=>value==='running').length>=2));
});

test('manual rejection blocks publication and approval keeps validation verdict', async () => {
  const config = {...clone(defaults),maxLoops:0};
  const reject = await run(config,{requestReview:async()=>({passed:false,note:'补充证据'})});
  assert.equal(reject.report,null);
  assert.equal(reject.status,'blocked');
  const approve = await run(config,{requestReview:async()=>({passed:true,note:'已人工核对原始订单'})});
  assert.equal(approve.status,'succeeded');
  assert.equal(approve.report.verified,false);
  assert.equal(approve.report.reviews[0].override,true);
});

test('DeepSeek workflow passes feedback and previous output to the retrying Agent', async () => {
  const payloads = [];
  const result = await run({...clone(defaults),mode:'deepseek'},{callModel: async payload => {
    payloads.push(payload);
    const {sum,count,findings} = payload.context.baseline;
    const citation = {duplicate:'R-001',negative_amount:'R-002',missing_region:'R-003'};
    const result = {sum,count,findings:findings.map(finding=>({id:finding.id,evidence:citation[finding.type],recommendation:'核对原始订单'}))};
    if (payload.agent.name==='数据分析师') result.sum = 0;
    return {result,usage:{total_tokens:12}};
  }});
  assert.equal(result.status,'succeeded');
  assert.equal(result.calls,3);
  assert.equal(result.tokens,36);
  assert.equal(payloads.at(-1).agent.name,'审计顾问');
  assert.ok(payloads.at(-1).feedback[0].includes('收入'));
  assert.equal(payloads.at(-1).previous.sum,0);
});

test('cycle validation, conditional skipping, nested workflows and capability load are observable', async () => {
  const config=clone(defaults);
  config.nodes[0].deps=['report'];
  assert.throws(()=>validateGraph(config.nodes),/死循环/);
  config.nodes[0].deps=[];
  config.nodes.push({id:'fallback',name:'例外分支',type:'subflow',flow:'nested',deps:['verify'],when:{node:'verify',passed:false},x:90,y:80,priority:20});
  config.subflows.nested=[{id:'sub-input',name:'子流程读取',type:'input',deps:[],x:20,y:20,priority:100}];
  assert.equal((await run(config)).states.fallback,'skipped');
  config.maxLoops=0;
  const result=await run(config);
  assert.equal(result.states['fallback/sub-input'],'done');
  assert.equal(chooseAgent(config.agents,'分析',new Map([['analyst',1]])).agent.id,'consultant');
});

test('DeepSeek HTTP adapter sends structured messages, retries an empty JSON response and handles credentials', async () => {
  const {deepseek}=await import('./proxy.mjs');
  const request = key => new Request('http://localhost/api/deepseek',{method:'POST',headers:{'content-type':'application/json',...(key?{'x-deepseek-key':key}:{})},body:JSON.stringify({model:'deepseek-flash',test:true})});
  assert.equal((await deepseek(request())).status,401);
  let count=0;
  const success = await deepseek(request('test-key'),{},async (url,options)=>{
    assert.equal(url,'https://api.deepseek.com/chat/completions');
    assert.equal(options.headers.authorization,'Bearer test-key');
    const body=JSON.parse(options.body);
    assert.equal(body.response_format.type,'json_object');
    assert.equal(body.model,'deepseek-flash');
    count++;
    return Response.json({choices:[{finish_reason:'stop',message:{content:count===1?' ':'{"ok":true}'}}]});
  });
  assert.deepEqual(await success.json(),{result:{ok:true}});
  assert.equal(count,2);
  assert.equal((await deepseek(request('test-key'),{},async()=>new Response(null,{status:429}))).status,429);
});
