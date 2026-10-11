// Common provider connection templates. Personal credentials stay empty.
export const providerTemplates={
  '火山引擎':{protocol:'chat',endpoint:'https://ark.cn-beijing.volces.com/api/v3',apiKey:'',models:['doubao-seed-2-0-lite-260428','doubao-seed-2-0-pro-260215']},
  '阿里云百炼（通义千问）':{protocol:'chat',endpoint:'https://dashscope.aliyuncs.com/compatible-mode/v1',apiKey:'',models:['qwen-plus','qwen3-vl-32b-thinking'],note:'北京区域兼容地址；新账号可改为控制台提供的工作空间专属域名。阅卷请选择视觉模型。'},
  'DeepSeek':{protocol:'chat',endpoint:'https://api.deepseek.com/v1',apiKey:'',models:['deepseek-v4-pro','deepseek-v4-flash'],note:'模型目录以账号可用列表为准；图片阅卷须选择支持视觉的型号。'},
  '月之暗面（Kimi）':{protocol:'chat',endpoint:'https://api.moonshot.cn/v1',apiKey:'',models:['kimi-k3'],note:'选择账号已开放、支持图片的模型；以官方模型目录为准。'},
  '智谱（GLM）':{protocol:'chat',endpoint:'https://open.bigmodel.cn/api/paas/v4',apiKey:'',models:['glm-5.3','glm-5.3-flash'],note:'通用API地址；图片阅卷请从目录选择视觉型号，编码套餐接口另行配置。'},
  '腾讯混元':{protocol:'chat',endpoint:'https://api.hunyuan.cloud.tencent.com/v1',apiKey:'',models:[],note:'使用混元OpenAI兼容API密钥；模型名从控制台或模型目录选择。'},
  '百度千帆':{protocol:'chat',endpoint:'https://qianfan.baidubce.com/v2',apiKey:'',models:[],note:'使用千帆API Key；按账号开通情况填写模型名或服务标识。'},
  '硅基流动':{protocol:'chat',endpoint:'https://api.siliconflow.cn/v1',apiKey:'',models:[],note:'先获取模型目录；阅卷请选择支持图片输入的视觉模型。'},
  'MiniMax':{protocol:'chat',endpoint:'https://api.minimaxi.com/v1',apiKey:'',models:[],note:'国内通用OpenAI兼容地址；模型及视觉能力以账号实际开放为准。'},
  '阶跃星辰':{protocol:'chat',endpoint:'https://api.stepfun.com/v1',apiKey:'',models:[],note:'先获取模型目录，图片阅卷选择视觉模型。'},
  '讯飞星火':{protocol:'chat',endpoint:'https://spark-api-open.xf-yun.com/v1',apiKey:'',models:[],note:'密钥栏填写HTTP兼容接口的APIPassword，非APPID；视觉接口可能需独立配置。'},
  'OpenAI兼容':{protocol:'chat',endpoint:'https://api.openai.com/v1',apiKey:'',models:['gpt-4o','gpt-4o-mini']}
};
