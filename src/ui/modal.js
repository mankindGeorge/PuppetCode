// 统一模态管理：设置 / 保存 / 关于三个遮罩共用一套栈。
// 职责：只让最上层遮罩可交互、Esc 只关闭最上层、打开时冻结背景、关闭后恢复焦点。
// 各弹窗只负责自己的打开动作与关闭时的数据保存，不再各自监听 Esc 或设置 inert。

var stack = [];

function backgroundElements() {
  return [document.querySelector('.menubar'), document.querySelector('.app')].filter(function (el) {
    return !!el;
  });
}

function canFocus(el) {
  return !!el && typeof el.focus === 'function' && document.contains(el) &&
    !el.closest('[hidden]') && !el.closest('[inert]');
}

function syncInert() {
  var hasModal = stack.length > 0;
  var top = hasModal ? stack[stack.length - 1].mask : null;

  backgroundElements().forEach(function (el) {
    el.inert = hasModal;
  });

  // 叠开时下层遮罩同样不可交互，避免 Tab 或点击穿透。
  document.querySelectorAll('.modal-mask').forEach(function (mask) {
    mask.inert = hasModal && mask !== top;
  });
}

export function isModalOpen() {
  return stack.length > 0;
}

// options: { onClose, initialFocus }
export function openModal(mask, options) {
  if (!mask) return;
  var config = options || {};

  // 同一遮罩重复打开时先出栈，避免重复登记。
  for (var i = stack.length - 1; i >= 0; i--) {
    if (stack[i].mask === mask) {
      stack.splice(i, 1);
      break;
    }
  }

  stack.push({
    mask: mask,
    onClose: config.onClose || null,
    restoreFocus: document.activeElement
  });

  mask.hidden = false;
  syncInert();

  var target = config.initialFocus || mask.querySelector('input, select, textarea, button, [tabindex]');
  if (canFocus(target)) target.focus();
}

export function closeModal(mask) {
  var index = -1;
  for (var i = stack.length - 1; i >= 0; i--) {
    if (stack[i].mask === mask) {
      index = i;
      break;
    }
  }
  if (index < 0) {
    if (mask) mask.hidden = true;
    return;
  }

  var wasTop = index === stack.length - 1;
  var entry = stack.splice(index, 1)[0];
  mask.hidden = true;
  syncInert();

  if (wasTop && canFocus(entry.restoreFocus)) entry.restoreFocus.focus();
}

document.addEventListener('keydown', function (event) {
  if (event.key !== 'Escape' || stack.length === 0) return;
  var entry = stack[stack.length - 1];
  event.preventDefault();
  if (entry.onClose) entry.onClose();
  else closeModal(entry.mask);
});
