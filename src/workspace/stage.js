// 首屏引导：空画布时显示操作卡片，示例工程可一键载入。
// 引导只在第一次进入时出现；一旦画布有积木就永久隐藏，不反复打扰。
import { Blockly } from '../vendor/index.js';
import { runtime } from '../state.js';
import { addLog } from '../ui/log.js';

var SAMPLE_XML = [
  '<xml xmlns="https://developers.google.com/blockly/xml">',
  '  <block type="puppet_servo_set" x="60" y="60">',
  '    <field name="SERVO">1</field>',
  '    <value name="ANGLE"><shadow type="math_number"><field name="NUM">90</field></shadow></value>',
  '    <next>',
  '      <block type="puppet_delay">',
  '        <value name="SECONDS"><shadow type="math_number"><field name="NUM">0.6</field></shadow></value>',
  '        <next>',
  '          <block type="puppet_servo_set">',
  '            <field name="SERVO">1</field>',
  '            <value name="ANGLE"><shadow type="math_number"><field name="NUM">140</field></shadow></value>',
  '            <next>',
  '              <block type="puppet_delay">',
  '                <value name="SECONDS"><shadow type="math_number"><field name="NUM">0.6</field></shadow></value>',
  '                <next>',
  '                  <block type="puppet_servo_set">',
  '                    <field name="SERVO">1</field>',
  '                    <value name="ANGLE"><shadow type="math_number"><field name="NUM">90</field></shadow></value>',
  '                  </block>',
  '                </next>',
  '              </block>',
  '            </next>',
  '          </block>',
  '        </next>',
  '      </block>',
  '    </next>',
  '  </block>',
  '</xml>'
].join('\n');

export function initStage() {
  var workspace = runtime.workspace;
  var empty = document.getElementById('stageEmpty');
  var sampleBtn = document.getElementById('sampleBtn');
  if (!workspace || !empty) return;

  var dismissed = false;

  function sync() {
    var hasBlocks = workspace.getAllBlocks(false).length > 0;
    if (hasBlocks) dismissed = true;
    empty.hidden = dismissed || hasBlocks;
  }

  function loadSample() {
    try {
      var dom = Blockly.utils.xml.textToDom(SAMPLE_XML);
      workspace.clear();
      Blockly.Xml.domToWorkspace(dom, workspace);
      Blockly.svgResize(workspace);

      var first = workspace.getTopBlocks(true)[0];
      if (first) workspace.centerOnBlock(first.id);

      addLog('info', '已载入示例：舵机转一转');
      dismissed = true;
      sync();

      var actionBtn = document.getElementById('runStopBtn');
      if (actionBtn) actionBtn.focus();
    } catch (error) {
      addLog('error', '示例载入失败：' + (error && error.message ? error.message : error));
    }
  }

  if (sampleBtn) sampleBtn.addEventListener('click', loadSample);

  workspace.addChangeListener(function (event) {
    if (event && event.isUiEvent) return;
    sync();
  });

  sync();
}
