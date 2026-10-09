// ========== 海云智评 DOM 选择器常量 ==========
// zp.kaow.cn/#/grade/teacher/index — Vue 2 + Element UI，hash 路由固定
// 答题卡为普通 <img>（阿里云 OSS 裁剪图，含 rotate/crop 参数需原样保留）
// 给分面板 .sub-item 含小题标题 + 满分文本 + input.inputs，多小题时并列多个
// 提交后弹出 el-dialog 二次确认，按钮带固定 ID

const HAIYUN_SELECTORS = {
    // 答题卡图片容器（多页时多个 .img_contain 各含一张）
    ANSWER_IMAGE: '.img_contain img',
    ANSWER_IMAGE_PRIMARY: '#leftimg',
    IMAGE_WRAPPER: '#leftimgWrapper2Id',

    // 给分面板小题项（多小题时多个并列，仅含 input 的计入）
    SCORE_ITEM: '.sub-item',
    SCORE_ITEM_LABEL: '.sub-name-caption',
    SCORE_ITEM_MAX: '.sub-score',
    SCORE_INPUT: 'input.inputs',

    // 提交按钮与二次确认弹窗（按钮 ID 固定，优于文本匹配）
    SUBMIT_BUTTON: '#btnSubmit',
    CONFIRM_SUBMIT: '#submitShortcutMarkPaper',
    CONFIRM_CANCEL: '#shortCutDlgCancelBtn',

    // 任务标识：页脚题组号（如 23.（1）），换题组/换小题时变化
    QUESTION_GROUP: '.question-id span',

    // 页面检测
    PAGE_DETECT_IMAGE: '#leftimg',
    PAGE_DETECT_INPUT: 'input.inputs',
    PAGE_DETECT_SUBMIT: '#btnSubmit',
};
