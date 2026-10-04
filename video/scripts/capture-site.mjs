/**
 * Capture the real Club Hub against a fresh, isolated LOCAL D1 database.
 * This script never accepts a remote URL and cannot address production data.
 */
import {spawn, execFileSync} from 'node:child_process';
import {mkdtemp, mkdir, readdir, writeFile} from 'node:fs/promises';
import {createServer} from 'node:net';
import {join, resolve} from 'node:path';
import {fileURLToPath} from 'node:url';
import {chromium} from 'playwright-core';

const videoDir = resolve(fileURLToPath(new URL('..', import.meta.url)));
const rootDir = resolve(videoDir, '..');
const stateRoot = join(videoDir, '.local-state');
const captureDir = join(videoDir, 'public', 'captures');
const assetDir = join(videoDir, 'public', 'data');
const wrangler = join(rootDir, 'node_modules', 'wrangler', 'bin', 'wrangler.js');
const config = join(rootDir, 'dist', 'server', 'wrangler.json');
const envImport = './scripts/sites-env.mjs';
const edgePath = process.env.VIDEO_BROWSER_PATH || 'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe';

function command(args, {cwd = rootDir} = {}) {
  return new Promise((resolvePromise, reject) => {
    const child = spawn(process.execPath, args, {cwd, windowsHide: true});
    let output = '';
    child.stdout.on('data', (part) => { output += part; });
    child.stderr.on('data', (part) => { output += part; });
    child.on('error', reject);
    child.on('exit', (code) => code === 0 ? resolvePromise(output) : reject(new Error(`${args.join(' ')} exited ${code}\n${output.slice(-5000)}`)));
  });
}

function freePort() {
  return new Promise((resolvePromise, reject) => {
    const server = createServer();
    server.once('error', reject);
    server.listen(0, '127.0.0.1', () => {
      const address = server.address();
      server.close(() => resolvePromise(address.port));
    });
  });
}

async function waitForApi(baseUrl, serverOutput) {
  for (let attempt = 0; attempt < 80; attempt++) {
    try {
      const response = await fetch(`${baseUrl}/api/club`, {signal: AbortSignal.timeout(2500)});
      if (response.ok) {
        const data = await response.json();
        if (Array.isArray(data.workers) && Array.isArray(data.menu)) return data;
      }
    } catch { /* Wrangler is still starting. */ }
    await new Promise((done) => setTimeout(done, 500));
  }
  throw new Error(`Local D1 preview did not become ready.\n${serverOutput().slice(-5000)}`);
}

async function post(baseUrl, action, fields = {}) {
  const response = await fetch(`${baseUrl}/api/club`, {
    method: 'POST',
    headers: {'content-type': 'application/json'},
    body: JSON.stringify({action, ...fields}),
  });
  const result = await response.json();
  if (!response.ok) throw new Error(`${action}: ${result.error || response.status}`);
  return result;
}

function assertDemo(test, message) {
  if (!test) throw new Error(`Demo data mismatch: ${message}`);
}

async function capture(page, filename) {
  // Wait for the product's AnimatedNumber and Recharts reveal to settle.
  await page.waitForTimeout(3000);
  await page.screenshot({path: join(captureDir, filename), type: 'jpeg', quality: 91, animations: 'disabled'});
  console.log(`Captured ${filename}`);
}

async function navigate(page, name, filename) {
  await page.getByRole('tab', {name, exact: true}).click();
  await capture(page, filename);
}

export async function captureSite() {
  await mkdir(stateRoot, {recursive: true});
  await mkdir(captureDir, {recursive: true});
  await mkdir(assetDir, {recursive: true});
  const stateDir = await mkdtemp(join(stateRoot, 'film-demo-'));
  const migrationNames = (await readdir(join(rootDir, 'drizzle')))
    .filter((name) => /^\d{4}_.+\.sql$/.test(name)).sort();
  if (migrationNames.length < 16) throw new Error('Expected the complete local D1 migration history');
  for (const name of migrationNames) {
    await command(['--import', envImport, wrangler, 'd1', 'execute', 'DB', '--local', '--config', config, '--persist-to', stateDir, '--file', join(rootDir, 'drizzle', name)]);
  }
  console.log(`Applied ${migrationNames.length} migrations to isolated demo D1`);

  const port = await freePort();
  const baseUrl = `http://127.0.0.1:${port}`;
  const server = spawn(process.execPath, ['--import', envImport, wrangler, 'dev', '--config', config, '--local', '--persist-to', stateDir, '--ip', '127.0.0.1', '--port', String(port), '--inspector-port', '0'], {
    cwd: rootDir,
    windowsHide: true,
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  let serverLog = '';
  server.stdout.on('data', (chunk) => { serverLog += chunk; });
  server.stderr.on('data', (chunk) => { serverLog += chunk; });
  let browser;
  try {
    const initial = await waitForApi(baseUrl, () => serverLog);
    assertDemo(initial.menu.some((item) => item.id === 'menu-equal'), 'seed menu-equal missing');
    assertDemo(initial.workers.some((worker) => worker.id === 'worker-muye'), 'seed worker-muye missing');
    browser = await chromium.launch({executablePath: edgePath, headless: true, args: ['--no-sandbox']});
    const page = await browser.newPage({viewport: {width: 1920, height: 1080}, deviceScaleFactor: 1, colorScheme: 'dark'});
    page.setDefaultTimeout(12000);
    await page.goto(baseUrl, {waitUntil: 'networkidle'});
    await page.getByRole('tab', {name: '总览', exact: true}).waitFor();
    await capture(page, '01-overview-before.jpg');
    await navigate(page, '价格表管理', '02-pricing.jpg');
    await navigate(page, '接单台', '03-order-desk.jpg');
    const deskActions = page.getByRole('button', {name: '选择两名打手'});
    if ((await deskActions.count()) >= 2) {
      await deskActions.nth(1).click();
      const confirmDialog = page.getByRole('dialog');
      await confirmDialog.locator('#custom-order-no').fill('DF-DEMO-0001');
      await confirmDialog.getByText('牧野', {exact: true}).click();
      await confirmDialog.getByText('北辰', {exact: true}).click();
      await capture(page, '04-order-confirm.jpg');
      await confirmDialog.getByRole('button', {name: '确认开始'}).click();
    } else {
      throw new Error('The order confirmation button was not found in real UI');
    }

    await page.getByText('1 单进行中').first().waitFor();
    const created = await (await fetch(`${baseUrl}/api/club`)).json();
    const orderId = created.orders.find((order) => order.custom_order_no === 'DF-DEMO-0001')?.id;
    assertDemo(typeof orderId === 'string', 'create_order did not return an ID');
    await page.reload({waitUntil: 'networkidle'});
    await navigate(page, '打手看板', '05-workforce-active.jpg');
    await navigate(page, '订单与结算', '06-order-active.jpg');
    await navigate(page, '打手看板', '07-workforce-before-finish.jpg');
    const finishActions = page.getByRole('button', {name: /打单结束/});
    if ((await finishActions.count()) > 0) {
      await finishActions.first().click();
      const tipInputs = page.getByRole('dialog').locator('input[id^="tip-"]');
      assertDemo((await tipInputs.count()) === 2, 'finish dialog must offer one tip input per worker');
      await tipInputs.nth(0).fill('20');
      await tipInputs.nth(1).fill('20');
      await capture(page, '08-finish-modal.jpg');
      await page.getByRole('dialog').getByRole('button', {name: '确认结束'}).click();
    } else {
      throw new Error('The finish action was not found in real UI');
    }
    await page.getByText('0 单进行中').first().waitFor();
    const finished = await (await fetch(`${baseUrl}/api/club`)).json();
    const filmOrder = finished.orders.find((order) => order.id === orderId);
    assertDemo(filmOrder?.status === 'completed', 'film order is not completed');
    assertDemo(filmOrder.total_price === 360, 'film price is not 360');
    assertDemo(filmOrder.final_club_income === 36, 'club income is not 36');
    assertDemo(filmOrder.worker_order_earnings['worker-muye'] === 162, 'Muye wage is not 162');
    assertDemo(filmOrder.worker_order_earnings['worker-beichen'] === 162, 'Beichen wage is not 162');
    assertDemo(filmOrder.worker_tip_earnings['worker-muye'] === 20, 'Muye instant tip is not 20');
    assertDemo(filmOrder.worker_tip_earnings['worker-beichen'] === 20, 'Beichen instant tip is not 20');
    await page.reload({waitUntil: 'networkidle'});
    await navigate(page, '订单与结算', '09-order-completed.jpg');
    await navigate(page, '工资结算', '10-payroll-active.jpg');

    const settled = await post(baseUrl, 'settle_worker_period', {worker_id: 'worker-muye', ended_at: Date.now()});
    await page.reload({waitUntil: 'networkidle'});
    await navigate(page, '工资结算', '11-payroll-closed.jpg');
    await page.getByRole('tab', {name: /待发放/}).click();
    await page.mouse.wheel(0, 760);
    await capture(page, '11-payroll-closed.jpg');
    await navigate(page, '总览', '12-overview-after.jpg');
    const allCompleted = settled.orders.filter((order) => order.status === 'completed');
    const demoData = {
      provenance: 'Fresh local D1 migrations and ensureSeeded() only; no hosted API or production data',
      sourceCommit: execFileSync('git', ['rev-parse', 'HEAD'], {cwd: rootDir, encoding: 'utf8'}).trim(),
      order: filmOrder,
      workers: settled.workers.filter((worker) => filmOrder.assigned_worker_ids.includes(worker.id)),
      menuItem: settled.menu.find((item) => item.id === 'menu-equal'),
      settlementRecord: settled.settlementRecords.find((record) => record.worker_id === 'worker-muye') ?? null,
      dashboard: {
        completedOrders: allCompleted.length,
        clubIncome: Number(allCompleted.reduce((sum, order) => sum + (order.final_club_income ?? 0), 0).toFixed(2)),
        wageExpense: Number(allCompleted.reduce((sum, order) => sum + Object.values(order.worker_order_earnings || {}).reduce((a, b) => a + b, 0), 0).toFixed(2)),
        instantTips: Number(allCompleted.reduce((sum, order) => sum + Object.values(order.worker_tip_earnings || {}).reduce((a, b) => a + b, 0), 0).toFixed(2)),
        dailyClubIncome: Object.entries(allCompleted.reduce((days, order) => {
          const day = new Intl.DateTimeFormat('en-CA', {timeZone: 'Asia/Shanghai', year: 'numeric', month: '2-digit', day: '2-digit'}).format(new Date(order.created_at));
          days[day] = Number(((days[day] || 0) + (order.final_club_income || 0)).toFixed(2));
          return days;
        }, {})).sort(([a], [b]) => a.localeCompare(b)),
        workerOrderCounts: settled.workers.map((worker) => ({
          id: worker.id,
          name: worker.name,
          count: allCompleted.filter((order) => order.assigned_worker_ids.includes(worker.id)).length,
        })).filter((entry) => entry.count > 0),
      },
      captures: (await readdir(captureDir)).filter((name) => name.endsWith('.jpg')).sort(),
    };
    await writeFile(join(assetDir, 'demo-data.json'), JSON.stringify(demoData, null, 2), 'utf8');
    console.log(`Verified actual D1 settlement: ¥${filmOrder.total_price} → workers ¥162 + ¥162, club ¥36, tips ¥20 + ¥20`);
    return demoData;
  } finally {
    await browser?.close();
    server.kill();
  }
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  captureSite().catch((error) => { console.error(error); process.exitCode = 1; });
}
