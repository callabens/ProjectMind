const copyButton = document.querySelector('[data-copy]');

copyButton?.addEventListener('click', async () => {
  const command = copyButton.dataset.copy;
  if (!command) return;
  try {
    await navigator.clipboard.writeText(command);
    copyButton.textContent = 'Copied';
  } catch {
    const helper = document.createElement('textarea');
    helper.value = command;
    helper.setAttribute('readonly', '');
    helper.style.position = 'fixed';
    helper.style.opacity = '0';
    document.body.append(helper);
    helper.select();
    copyButton.textContent = document.execCommand('copy') ? 'Copied' : 'Select & copy';
    helper.remove();
  }
  window.setTimeout(() => { copyButton.textContent = 'Copy'; }, 1800);
});

const replayButton = document.querySelector('[data-replay]');
const proofSteps = [...document.querySelectorAll('.proof-step')];
const terminalStatus = document.querySelector('[data-terminal-status]');

function replayProof() {
  proofSteps.forEach((step) => step.classList.remove('is-visible'));
  if (terminalStatus) terminalStatus.textContent = 'verifying...';
  proofSteps.forEach((step, index) => {
    window.setTimeout(() => {
      step.classList.add('is-visible');
      if (index === proofSteps.length - 1 && terminalStatus) terminalStatus.textContent = 'verified';
    }, 280 * (index + 1));
  });
}
replayButton?.addEventListener('click', replayProof);
