import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import {fileURLToPath} from 'node:url';

// Call only after every database and browser profile has been closed.
export function resetPersonalData(root,defaultConfig) {
  const workspace=fs.realpathSync(root);
  const backup=path.join(workspace,'backups','factory-reset-'+Date.now()+'-'+crypto.randomUUID().slice(0,8));
  const names=['config.json','shared-providers.json','default-task-deleted.json','data','sessions','archived-sessions','browser-profile','ui-profile','.env'];
  for(const name of fs.readdirSync(workspace))if(name.startsWith('.env.')||name.startsWith('config.json.')||name.startsWith('shared-providers.json.'))names.push(name);
  const targets=[...new Set(names)].map(name=>({name,source:path.resolve(workspace,name)})).filter(t=>fs.existsSync(t.source));
  for(const target of targets){
    if(path.dirname(target.source)!==workspace||fs.lstatSync(target.source).isSymbolicLink())throw Error('个人数据路径异常，未执行还原');
  }
  fs.mkdirSync(backup,{recursive:true});const moved=[];
  try {
    for(const target of targets){fs.renameSync(target.source,path.join(backup,target.name));moved.push(target);}
    const config=structuredClone(defaultConfig);config.sharedProvidersMigrated=true;
    fs.writeFileSync(path.join(workspace,'config.json'),JSON.stringify(config,null,2));
    fs.writeFileSync(path.join(workspace,'shared-providers.json'),JSON.stringify(config.providers,null,2));
    fs.writeFileSync(path.join(backup,'还原说明.txt'),'此目录含还原前的个人任务、密钥和登录资料，仅供本机恢复。不要上传或随软件分发。内置适配和接口模板保存在软件源文件中，不受还原影响。','utf8');
    return backup;
  } catch(error){
    for(const target of moved.reverse()){
      if(fs.existsSync(target.source)&&fs.lstatSync(target.source).isFile())fs.unlinkSync(target.source);
      fs.renameSync(path.join(backup,target.name),target.source);
    }
    throw error;
  }
}
if(process.argv[1]&&path.resolve(process.argv[1])===fileURLToPath(import.meta.url)){
  if(process.argv[2]!=='--confirmed')throw Error('请双击一键还原.cmd，查看范围并确认');
  const appRoot=fileURLToPath(new URL('..',import.meta.url));
  const root=process.env.AI_MARKER_DATA_ROOT || appRoot;
  fs.mkdirSync(root,{recursive:true});
  const config=JSON.parse(fs.readFileSync(path.join(appRoot,'config.example.json'),'utf8'));
  console.log('还原完成。个人资料备份：'+resetPersonalData(root,config));
  console.log('请双击“启动可视化.cmd”重新启动。');
}
