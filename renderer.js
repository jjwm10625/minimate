const { ipcRenderer } = require('electron');

document.getElementById('choose').addEventListener('click', async () => {
  const preview = document.getElementById('preview');
  const placeholder = document.getElementById('previewPlaceholder');

  try {
    const result = await ipcRenderer.invoke('select-image');
    if (result) {
      preview.src = result;
      preview.classList.remove("hidden");
      placeholder.classList.add("hidden");
      showToast("이미지를 불러왔습니다.", "bg-green-500");
    } else {
      preview.classList.add("hidden");
      placeholder.classList.remove("hidden");
      showToast("선택이 취소되었습니다.", "bg-gray-400");
    }
  } catch (err) {
    preview.classList.add("hidden");
    placeholder.classList.remove("hidden");
    showToast("이미지 처리 중 오류가 발생했습니다.", "bg-red-500");
  }
});

document.getElementById('applySize').addEventListener('click', async () => {
  const input = document.getElementById('iconSizeInput');
  const size = parseInt(input.value);

  if (isNaN(size) || size < 8 || size > 48) {
    showToast("아이콘 크기는 8 ~ 48 사이여야 합니다.", "bg-red-500");
    return;
  }

  const success = await ipcRenderer.invoke('set-icon-size', size);
  if (success) {
    showToast(`아이콘 크기가 ${size}px로 적용되었습니다.`, "bg-green-500");
  } else {
    showToast("아이콘 크기 변경에 실패했습니다.", "bg-red-500");
  }
});

function showToast(message, colorClass) {
  const toast = document.getElementById('toast');
  toast.innerText = message;

  toast.className =
    "fixed bottom-5 left-1/2 -translate-x-1/2 px-3 py-1.5 rounded-md shadow-lg text-white text-xs transition-opacity duration-300";
  toast.classList.add(colorClass);

  toast.style.opacity = "1";
  toast.classList.remove("hidden");

  setTimeout(() => {
    toast.style.opacity = "0";
    setTimeout(() => {
      toast.classList.add("hidden");
    }, 300);
  }, 2500);
}

ipcRenderer.on('error', (_, msg) => {
  showToast(msg, "bg-red-500");
});

ipcRenderer.on('gif-fallback', () => {
  showToast("GIF 변환 실패 → PNG 첫 프레임으로 대체되었습니다.", "bg-yellow-500");
});

ipcRenderer.on('icon-size-changed', (_, size) => {
  const input = document.getElementById('iconSizeInput');
  if (input) input.value = size;
  showToast(`현재 아이콘 크기: ${size}px`, "bg-gray-600");
});
