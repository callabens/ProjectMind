import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

const html = await readFile(new URL('../public/index.html', import.meta.url), 'utf8');

test('landing page presents the evidence-first product story', () => {
  assert.match(html, /Your agent writes code/);
  assert.match(html, /ProjectMind.*checks the evidence/s);
  assert.match(html, /Intent/);
  assert.match(html, /Evidence/);
  assert.match(html, /VERIFIED/);
});

test('landing page links to install, source, npm, and online MCP docs', () => {
  assert.match(html, /npm install -g @callabens\/projectmind@next/);
  assert.match(html, /https:\/\/github\.com\/callabens\/ProjectMind/);
  assert.match(html, /https:\/\/www\.npmjs\.com\/package\/@callabens\/projectmind/);
  assert.match(html, /docs\/ONLINE_MCP\.md/);
});

test('landing page keeps health and MCP endpoints discoverable', () => {
  assert.match(html, /href="\/health"/);
  assert.match(html, /href="\/mcp"/);
});
