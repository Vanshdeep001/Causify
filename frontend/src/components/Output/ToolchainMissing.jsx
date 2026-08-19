/* -------------------------------------------------------
 * ToolchainMissing.jsx — "nothing ran, and it is not your code"
 *
 * Causify compiles with the tools already on the machine, the way an editor
 * does. Java is the exception — it ships inside the app, because the app itself
 * runs on it — so a user can go a long time without discovering that C++ needs
 * a compiler they never installed.
 *
 * What they used to get was ProcessBuilder's IOException: "The system cannot
 * find the file specified", quoting a path in the temp directory and never
 * mentioning gcc. That reads as "the program crashed", so people go looking
 * through their own source for a bug that is not there. The failure is in the
 * environment, and it is completely fixable in about two minutes — but only if
 * someone says so.
 *
 * Hence a real answer rather than an error line: what is missing, why Causify
 * wanted it, the exact command to install it, and the one non-obvious step
 * afterwards — restarting, because PATH is read at launch.
 * ------------------------------------------------------- */

import React, { useState } from 'react';

/* Detected from the renderer rather than passed down: the backend can be on
   another machine in a shared session, and the instructions have to describe
   the computer the person is sitting at. */
const detectOs = () => {
  const ua = (navigator.userAgent || '').toLowerCase();
  if (ua.includes('win')) return 'win';
  if (ua.includes('mac')) return 'mac';
  return 'linux';
};

const OS_LABEL = { win: 'Windows', mac: 'macOS', linux: 'Linux' };

/*
 * One entry per tool the backend can report as missing.
 *
 * The commands are the ones most likely to work unattended on a stock machine,
 * not the ones a given developer prefers: winget ships with Windows 11 and
 * modern 10, xcode-select is built into macOS, apt covers Debian and Ubuntu.
 * Where a package manager is not a safe assumption, the download page is the
 * primary route and the command is the shortcut.
 */
const TOOLCHAINS = {
  'g++': {
    language: 'C++',
    blurb: 'Causify compiles C++ with g++ from your system, the same compiler your terminal would use.',
    win: {
      name: 'MSYS2 (MinGW-w64)',
      command: 'winget install -e --id MSYS2.MSYS2',
      after: 'Then open "MSYS2 UCRT64" and run:  pacman -S mingw-w64-ucrt-x86_64-gcc',
      url: 'https://www.msys2.org/',
      note: 'Add C:\\msys64\\ucrt64\\bin to your PATH so Causify can find g++.',
    },
    mac: {
      name: 'Xcode Command Line Tools',
      command: 'xcode-select --install',
      url: 'https://developer.apple.com/xcode/resources/',
      note: 'Provides clang, which answers to g++.',
    },
    linux: {
      name: 'build-essential',
      command: 'sudo apt install build-essential',
      url: 'https://gcc.gnu.org/install/',
      note: 'On Fedora or RHEL:  sudo dnf install gcc-c++',
    },
  },
  gcc: {
    language: 'C',
    blurb: 'Causify compiles C with gcc from your system, the same compiler your terminal would use.',
    win: {
      name: 'MSYS2 (MinGW-w64)',
      command: 'winget install -e --id MSYS2.MSYS2',
      after: 'Then open "MSYS2 UCRT64" and run:  pacman -S mingw-w64-ucrt-x86_64-gcc',
      url: 'https://www.msys2.org/',
      note: 'Add C:\\msys64\\ucrt64\\bin to your PATH so Causify can find gcc.',
    },
    mac: {
      name: 'Xcode Command Line Tools',
      command: 'xcode-select --install',
      url: 'https://developer.apple.com/xcode/resources/',
      note: 'Provides clang, which answers to gcc.',
    },
    linux: {
      name: 'build-essential',
      command: 'sudo apt install build-essential',
      url: 'https://gcc.gnu.org/install/',
      note: 'On Fedora or RHEL:  sudo dnf install gcc',
    },
  },
  python: {
    language: 'Python',
    blurb: 'Causify runs Python scripts with the interpreter installed on your system.',
    win: {
      name: 'Python 3',
      command: 'winget install -e --id Python.Python.3.12',
      url: 'https://www.python.org/downloads/',
      note: 'If you use the installer instead, tick "Add python.exe to PATH" on the first screen.',
    },
    mac: {
      name: 'Python 3',
      command: 'brew install python',
      url: 'https://www.python.org/downloads/macos/',
      note: 'The python.org installer works just as well if you do not use Homebrew.',
    },
    linux: {
      name: 'Python 3',
      command: 'sudo apt install python3',
      url: 'https://www.python.org/downloads/source/',
      note: 'Most distributions ship it already.',
    },
  },
  node: {
    language: 'JavaScript',
    blurb: 'Causify runs JavaScript files with Node.js from your system.',
    win: {
      name: 'Node.js LTS',
      command: 'winget install -e --id OpenJS.NodeJS.LTS',
      url: 'https://nodejs.org/en/download',
      note: null,
    },
    mac: {
      name: 'Node.js LTS',
      command: 'brew install node',
      url: 'https://nodejs.org/en/download',
      note: null,
    },
    linux: {
      name: 'Node.js LTS',
      command: 'sudo apt install nodejs npm',
      url: 'https://nodejs.org/en/download/package-manager',
      note: null,
    },
  },
};

const ToolchainMissing = ({ tool }) => {
  const [copied, setCopied] = useState(false);
  const os = detectOs();

  const spec = TOOLCHAINS[tool];
  // An unknown tool is still worth explaining, just without the install recipe.
  const install = spec?.[os];

  const copy = () => {
    if (!install?.command) return;
    navigator.clipboard.writeText(install.command);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  return (
    <div className="tcm">
      <div className="tcm-head">
        <span className="tcm-eyebrow">Toolchain required</span>
        <span className="tcm-rule" />
        <span className="tcm-os">{OS_LABEL[os]}</span>
      </div>

      <div className="tcm-title">
        <code className="tcm-tool">{tool}</code>
        <span className="tcm-title-rest">is not installed on this machine</span>
      </div>

      <p className="tcm-body">
        {spec
          ? `${spec.blurb} Nothing was compiled and nothing ran, so there is no output to show — your ${spec.language} code has not been judged either way.`
          : 'The program Causify needs to run this file could not be found on your system, so nothing was compiled and nothing ran.'}
      </p>

      {install && (
        <div className="tcm-install">
          <div className="tcm-label">Install {install.name}</div>

          <div className="tcm-cmd">
            <code>{install.command}</code>
            <button className="tcm-copy" onClick={copy} title="Copy to clipboard">
              {copied ? 'Copied' : 'Copy'}
            </button>
          </div>

          {install.after && <div className="tcm-after">{install.after}</div>}
          {install.note && <div className="tcm-note">{install.note}</div>}

          <a className="tcm-link" href={install.url} target="_blank" rel="noreferrer">
            Open the download page
            <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor"
              strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
              <line x1="7" y1="17" x2="17" y2="7" />
              <polyline points="7 7 17 7 17 17" />
            </svg>
          </a>
        </div>
      )}

      {/* The step everybody misses. Causify inherits PATH from the moment it
          launched, so a toolchain installed since then is invisible to it — and
          the second attempt fails identically, which looks like the install
          having failed. */}
      <div className="tcm-foot">
        <span className="tcm-foot-mark" />
        Restart Causify once it is installed — the app reads your PATH when it starts,
        so a new toolchain will not be found until then.
      </div>
    </div>
  );
};

export default ToolchainMissing;
