// Blockly 11.2.2（官方 UMD 构建产物）与简体中文语言包。
// 三份脚本按顺序执行：核心（含英文消息）→ Python 生成器 → 中文消息覆盖。
// vendor 目录内文件由官方发布包原样拷入，仅把 UMD 包装的 this 改为 window 以适配 ES 模块。
import './blockly/blockly_compressed.js';
import './blockly/blockly_python.js';
import './blockly/zh-hans.js';

export const Blockly = window.Blockly;
