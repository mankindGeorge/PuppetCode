// 自定义控制积木：舵机、延时与组合动作（Blockly 原生 JSON 定义）。
import { Blockly } from '../vendor/index.js';

export function defineCustomBlocks() {
  Blockly.defineBlocksWithJsonArray([
    {
      type: 'puppet_servo_set',
      message0: '舵机 %1 转到 %2 度',
      args0: [
        {
          type: 'field_dropdown',
          name: 'SERVO',
          options: [
            ['1 号', '1'],
            ['2 号', '2'],
            ['3 号', '3'],
            ['4 号', '4']
          ]
        },
        {
          type: 'input_value',
          name: 'ANGLE',
          check: 'Number'
        }
      ],
      inputsInline: true,
      previousStatement: null,
      nextStatement: null,
      colour: '#32B987',
      tooltip: '控制 1-4 号舵机转到目标角度（0-180 度）',
      helpUrl: ''
    },
    {
      type: 'puppet_delay',
      message0: '等待 %1 秒',
      args0: [
        {
          type: 'input_value',
          name: 'SECONDS',
          check: 'Number'
        }
      ],
      inputsInline: true,
      previousStatement: null,
      nextStatement: null,
      colour: '#2D9BFA',
      tooltip: '等待指定秒数，可被「停止」指令中断',
      helpUrl: ''
    },
    {
      type: 'puppet_action_bow',
      message0: '皮影作揖（开发中）',
      previousStatement: null,
      nextStatement: null,
      colour: '#9270E8',
      tooltip: '预留组合动作，生成 action_bow() 空函数调用',
      helpUrl: ''
    },
    {
      type: 'puppet_action_wave',
      message0: '皮影挥手（开发中）',
      previousStatement: null,
      nextStatement: null,
      colour: '#9270E8',
      tooltip: '预留组合动作，生成 action_wave() 空函数调用',
      helpUrl: ''
    },
    {
      type: 'puppet_action_nod',
      message0: '皮影点头（开发中）',
      previousStatement: null,
      nextStatement: null,
      colour: '#9270E8',
      tooltip: '预留组合动作，生成 action_nod() 空函数调用',
      helpUrl: ''
    }
  ]);
}
