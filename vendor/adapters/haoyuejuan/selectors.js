// ========== 阅小二 DOM 选择器常量 ==========
// www.haoyuejuan.com/yuejuan/#/reading — Vue 3 + Element Plus
// 与五岳阅卷 (wylkyj.com) 同构：.imageBox/.outBox/.computeItem，图片托管在 data.wylkyj.com

const HAOYUEJUAN_SELECTORS = {
    // 答题卡图片容器（hideBox 为预载的其他学生卷，只取可见区）
    IMAGE_BOX: '.imageBox',
    OUT_BOX: '.outBox',
    OUT_BOX_ACTIVE: '.outBox:not(.hideBox)',
    ANSWER_IMAGE: '.outBox:not(.hideBox) .imgSection img',
    ANSWER_IMAGE_ALL: '.imgSection img',

    // 分数输入框（单小题模式）
    SCORE_INPUT_SINGLE: '#inputOne',

    // 分小题区域
    SCORE_LIST: '.computeList',
    SCORE_ITEM: '.computeItem',
    SCORE_ITEM_NUM: '.computeItem .num',
    SCORE_ITEM_INPUT: '.computeItem .el-input__inner',

    // 提交按钮
    SUBMIT_BUTTON: '.btnSubmit',
    SUBMIT_BUTTON_TEXT: '提交得分',

    // 回评：正常态是「回评上一份」，回评态是「取消回评」(button.redBtn)
    BACK_UP_BUTTON: '.btnBackUp',
    CANCEL_REGRADE_BUTTON: 'button.redBtn',

    // 满分/零分按钮
    FULL_SCORE_BUTTON: '.computeItem .full',
    ZERO_SCORE_BUTTON: '.computeItem .zero',

    // 页面检测
    PAGE_DETECT_IMAGE: '.outBox .imgSection img',
    PAGE_DETECT_INPUT: '#inputOne',
    PAGE_DETECT_SUBMIT: '.btnSubmit',
};
