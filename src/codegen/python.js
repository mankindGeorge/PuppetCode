// MicroPython 代码生成器。
// 复用 Blockly 内置 Python 生成器（MicroPython 为 Python 3 方言），
// 仅对自定义积木追加映射，不引入任何第三方生成器。
import { Blockly } from '../vendor/index.js';

export function setupGenerator() {
  var py = Blockly.Python;

  py.forBlock['puppet_servo_set'] = function (block, generator) {
    var servo = block.getFieldValue('SERVO');
    var angle = generator.valueToCode(block, 'ANGLE', py.ORDER_NONE) || '90';
    return 'servo_set(' + servo + ', ' + angle + ')\n';
  };

  py.forBlock['puppet_delay'] = function (block, generator) {
    var seconds = generator.valueToCode(block, 'SECONDS', py.ORDER_NONE) || '1';
    return 'puppet_delay(' + seconds + ')\n';
  };

  py.forBlock['puppet_action_bow'] = function () {
    return 'action_bow()\n';
  };

  py.forBlock['puppet_action_wave'] = function () {
    return 'action_wave()\n';
  };

  py.forBlock['puppet_action_nod'] = function () {
    return 'action_nod()\n';
  };
}
