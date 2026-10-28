// 积木工作区主题：浅蓝纸面与蓝色辅助色，和卡片式界面保持一致。
import { Blockly } from '../vendor/index.js';

export function createTheme() {
  return Blockly.Theme.defineTheme('puppetBlue', {
    base: Blockly.Themes.Zelos,
    componentStyles: {
      // 与 .workspace-wrap 的 --color-workspace-bg 保持同一档浅蓝
      workspaceBackgroundColour: '#F5FAFF',
      toolboxBackgroundColour: '#FFFFFF',
      toolboxForegroundColour: '#244B7A',
      flyoutBackgroundColour: '#F0F8FF',
      flyoutForegroundColour: '#244B7A',
      flyoutOpacity: 1,
      scrollbarColour: '#B8DFFF',
      scrollbarOpacity: 1,
      insertionMarkerColour: '#1177F1',
      insertionMarkerOpacity: 0.35,
      cursorColour: '#1177F1'
    },
    fontStyle: {
      family: '"Microsoft YaHei", "PingFang SC", "Noto Sans SC", sans-serif',
      weight: '500',
      size: 11
    }
  });
}
