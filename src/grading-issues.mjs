// Agreement between models cannot resolve a missing teacher marking rule.
// Reuse the existing mandatory review path instead of treating this as OCR.
export function withGradingIssueWarnings(result) {
  const candidates=[result,result?.dualEval?.a,result?.dualEval?.b,result?.dualEval?.verdict].filter(Boolean);
  const warnings=[];
  for(const candidate of candidates){
    if(candidate.policyWarning)warnings.push(candidate.policyWarning);
    if(candidate.gradingIssues===undefined)continue; // Older model responses.
    if(!Array.isArray(candidate.gradingIssues)){
      warnings.push('模型评分规则疑点字段无效，请人工核对。');
      continue;
    }
    for(const issue of candidate.gradingIssues){
      if(!issue || typeof issue.location!=='string' || !issue.location.trim() || typeof issue.reason!=='string' || !issue.reason.trim()){
        warnings.push('模型报告了未说明位置或原因的评分规则疑点，请人工核对。');
      }else{
        warnings.push(`评分规则疑点：${issue.location.trim()}：${issue.reason.trim()}；请人工确认。`);
      }
    }
  }
  if(!warnings.length)return result;
  return {...result,formatWarning:[...new Set([result.formatWarning,...warnings].filter(Boolean).flatMap(warning=>warning.split('\n')))].join('\n')};
}
