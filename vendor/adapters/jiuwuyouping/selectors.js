// ========== 九五优评 DOM 选择器常量 ==========
// 平台入口 timesphoenix.com，阅卷 DOM 全部位于 iframe#main_frame 内部
// iframe 页面为 sjpy/sjpy_kspy.jsp?ksdm=&kmdm=&stbh=

const JIUWUYOUPING_SELECTORS = {
    // 阅卷 iframe（壳页 main.jsp 内）
    MARK_FRAME: '#main_frame',

    // 答题卡图片（多页时为 mainimg_0 / mainimg_1 ...，跨端口 :88）
    ANSWER_IMAGE: 'img[id^="mainimg_"]',
    ANSWER_IMAGE_FIRST: 'img#mainimg_0',

    // 给分点容器与输入框（id 为 dfd0 / dfd1 ...）
    SCORE_ITEM: '.dfddiv',
    SCORE_INPUT: 'input.dfdinput',
    SCORE_LABEL: '.dfdspan',

    // 合计显示
    TOTAL_SCORE: '.notice-zf .score',

    // 提交按钮（onclick="tjfs()"）
    SUBMIT_BUTTON: '#tjfsbtn',

    // 打分确认弹窗文案节点（tjfs 内 $("#qrfs").html(...)）
    CONFIRM_MSG: '#qrfs',

    // 页面检测
    PAGE_DETECT_IMAGE: 'img[id^="mainimg_"]',
    PAGE_DETECT_INPUT: 'input.dfdinput',
    PAGE_DETECT_SUBMIT: '#tjfsbtn',
};
