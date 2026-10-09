export function isZhixuePage(value) {
  try {
    const url=new URL(value);
    return url.protocol==='https:' && !url.username && !url.password && !url.port &&
      (url.hostname==='zhixue.com' || url.hostname.endsWith('.zhixue.com'));
  } catch { return false; }
}

export function resolveZhixueOptions(options={},pageUrl) {
  // Empty new-task settings use the built-in adapter; custom selectors retain their own tests.
  if(!isZhixuePage(pageUrl) || options.identityMode && options.identityMode!=='zhixue-network' ||
    ['frameUrlPattern','paperIdSelector','imageSelector','scoreSelector','submitSelector','identityRequestField','scoresRequestField'].some(key=>options[key])) return options;
  return {...options,identityMode:'zhixue-network',builtinAdapter:'zhixue',verified:true,
    submitResponseUrlPattern:options.submitResponseUrlPattern || '^https://pt-ali-bj(?:-re)?\\.zhixue\\.com/marking/marking/commitTopic/$'};
}
