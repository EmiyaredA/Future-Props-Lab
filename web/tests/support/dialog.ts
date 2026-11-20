/** Model the dialog APIs missing from jsdom without mocking application code. */
export function installDialogTestSupport() {
  const prototype = HTMLDialogElement.prototype;
  if (typeof prototype.showModal !== "function") {
    prototype.showModal = function () {
      this.open = true;
    };
  }
  if (typeof prototype.close !== "function") {
    prototype.close = function (returnValue?: string) {
      if (!this.open) return;
      this.open = false;
      if (returnValue !== undefined) this.returnValue = returnValue;
      this.dispatchEvent(new Event("close"));
    };
  }
}
