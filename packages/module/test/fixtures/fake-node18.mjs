// 预加载脚本：让被测进程认为自己运行在 Node 18（只改版本串，运行时仍是当前 Node）。
Object.defineProperty(process.versions, 'node', { value: '18.20.0', configurable: true });
