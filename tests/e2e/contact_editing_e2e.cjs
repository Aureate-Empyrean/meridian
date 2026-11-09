// Local synthetic-data regression journey. Start tests/e2e/harness.py on port 17401.
const assert = require('node:assert/strict');
const { chromium } = require(process.env.PLAYWRIGHT_PATH || '../../../mnemosyne/node_modules/playwright');
const BASE = process.env.HARNESS || 'http://127.0.0.1:17401';
async function api(path, method = 'GET', body) {
  const r = await fetch(BASE + '/api' + path, { method, headers: { 'x-nexus-gateway-key': 'h'.repeat(40), 'content-type': 'application/json' }, body: body === undefined ? undefined : JSON.stringify(body) });
  assert(r.ok, await r.clone().text());
  return r.json();
}
(async () => {
  const person = await api('/people', 'POST', { names: [{ value: 'Unified editing regression' }], addresses: [{ formatted: 'Original formatted address', locality: 'Old city' }] });
  const browser = await chromium.launch();
  try {
    const page = await browser.newPage({ reducedMotion: 'reduce', viewport: process.env.PHONE ? { width: 390, height: 844 } : { width: 1440, height: 900 } });
    await page.goto(BASE + '/__harness');
    const f = page.frames().find(fr => fr !== page.mainFrame());
    await f.waitForFunction(() => typeof go === 'function');
    await f.evaluate(id => go('person', id), person.id);
    await f.locator('[data-act="edit"][data-section="contacts"]').first().click();
    const save = f.locator('#panel [data-act="panel-save"]');
    const tab = async key => f.locator(`[data-act="panel-section"][data-section="${key}"]`).click();
    const field = key => f.locator(`#panel-body [data-k="${key}"]`).first();
    const saved = async () => { await save.click(); await f.waitForFunction(() => !panel.saving && !panel.isDirty()); assert(await f.locator('#panel').isVisible()); assert(await save.isDisabled()); };
    assert(await save.isDisabled());
    await f.locator('[data-act="add-row"]').click(); assert(await save.isEnabled());
    await f.locator('[data-act="remove-row"]').last().click(); assert(await save.isDisabled());
    await field('is_primary').check(); assert(await save.isEnabled());
    await field('is_primary').uncheck(); assert(await save.isDisabled());
    await field('value').fill('+421900123456');
    await tab('notes'); await f.locator('#notes').fill('Together');
    await tab('employments'); await field('organization').fill('Draft organization');
    await tab('accounts'); await field('service').fill('github'); await field('handle').fill('draft-user');
    await tab('addresses'); await field('locality').fill('Draft city');
    await tab('names'); await field('value').fill('Unified saved name');
    await tab('facts'); await field('key').fill('Favourite'); await field('value').fill('Blue');
    await tab('dates');
    await f.locator('#panel-body [data-part="y"]').fill('2000');
    await f.locator('#panel-body [data-part="m"]').selectOption('02');
    await f.locator('#panel-body [data-part="d"]').fill('31');
    await tab('contacts'); assert.equal(await field('value').inputValue(), '+421900123456');
    // Client validation in a hidden tab blocks even otherwise valid changes.
    await f.locator('#panel [aria-label="Close"]').click(); await f.locator('#contact-save').click();
    await f.locator('#panel #form-error').waitFor({ state: 'visible' });
    assert.equal(await f.locator('#panel-title').textContent(), 'Personal dates');
    assert.equal((await api('/people/' + person.id)).contacts.length, 0);
    await f.locator('#panel-body [data-part="m"]').selectOption('05');
    await f.locator('#panel-body [data-part="d"]').fill('');
    await tab('contacts');
    assert.equal((await api('/people/' + person.id)).contacts.length, 0);
    await saved();
    assert.equal(await f.locator('#panel-title').textContent(), 'Contact');
    let current = await api('/people/' + person.id);
    assert.equal(current.notes, 'Together'); assert.equal(current.employments.length, 1); assert.equal(current.contacts.length, 1);
    assert.equal(current.accounts[0].handle, 'draft-user'); assert.equal(current.addresses[0].locality, 'Draft city');
    assert.equal(current.names[0].value, 'Unified saved name'); assert.equal(current.facts[0].value, 'Blue');
    assert.equal(current.dates[0].date, '2000-05');
    const contactId = current.contacts[0].id;
    await tab('notes'); await f.locator('#notes').fill('Second save'); await saved();
    current = await api('/people/' + person.id); assert.equal(current.contacts[0].id, contactId);
    await f.locator('#notes').fill('Cancel this'); await f.locator('[data-act="panel-cancel"]').click();
    await f.locator('#panel').waitFor({ state: 'detached' });
    assert.equal((await api('/people/' + person.id)).notes, 'Second save');
    await f.evaluate(() => openPanel('notes'));
    await f.locator('#notes').fill('Close draft');
    await f.locator('#panel [aria-label="Close"]').click();
    await f.getByRole('button', { name: 'Continue editing', exact: true }).click();
    assert.equal(await f.locator('#notes').inputValue(), 'Close draft');
    await f.locator('#panel [aria-label="Close"]').click(); await f.locator('#contact-save').click();
    await f.locator('#panel').waitFor({ state: 'detached' });
    assert.equal((await api('/people/' + person.id)).notes, 'Close draft');
    await f.evaluate(() => openPanel('notes')); await f.locator('#notes').fill('Discard this');
    await f.locator('#panel [aria-label="Close"]').click(); await f.locator('#contact-discard').click();
    await f.locator('#panel').waitFor({ state: 'detached' });
    assert.equal((await api('/people/' + person.id)).notes, 'Close draft');
    // Invalid input on an inactive tab must block the entire document.
    await f.evaluate(() => openPanel('contacts'));
    await field('channel').selectOption('email'); await field('value').fill('invalid email');
    await tab('notes'); await f.locator('#notes').fill('Blocked by validation');
    await save.click(); await f.locator('#panel #form-error').waitFor({ state: 'visible' });
    assert.equal(await f.locator('#panel-title').textContent(), 'Contact');
    assert.equal((await api('/people/' + person.id)).notes, 'Close draft');
    await field('value').fill('valid@example.com'); await saved();
    // A failed request retains all drafts and allows a retry.
    await tab('notes'); await f.locator('#notes').fill('Retry me');
    await page.route('**/api/people/' + person.id, route => route.request().method() === 'PUT' ? route.fulfill({ status: 503, contentType: 'application/json', body: JSON.stringify({ detail: 'Injected persistence failure' }) }) : route.continue());
    await save.click(); await f.locator('#panel #form-error').waitFor({ state: 'visible' });
    assert.equal(await f.locator('#notes').inputValue(), 'Retry me'); assert.equal(await save.isEnabled(), true);
    await page.unroute('**/api/people/' + person.id); await saved();
    // Freeze the draft and Save while a slow request is in flight.
    await f.locator('#notes').fill('Slow save');
    let release; const gate = new Promise(r => release = r);
    await page.route('**/api/people/' + person.id, async route => { if (route.request().method() === 'PUT') await gate; await route.continue(); });
    await save.click(); await f.waitForFunction(() => panel.saving);
    assert(await save.isDisabled()); assert(await f.locator('#panel').evaluate(el => el.inert));
    release(); await f.waitForFunction(() => !panel.saving && !panel.isDirty()); await page.unroute('**/api/people/' + person.id);
    // Preserve fields which the editor does not expose.
    await tab('addresses'); await field('locality').fill('New city'); await saved();
    assert.equal((await api('/people/' + person.id)).addresses[0].formatted, 'Original formatted address');
    // Two editors must not silently overwrite one another.
    await tab('notes'); await f.locator('#notes').fill('Stale draft');
    const other = await api('/people/' + person.id);
    await f.evaluate(async p => { const doc = editable(p); doc.notes = 'Other writer'; doc.expected_revision = p.edit_revision; await api(entityApi(p), 'PUT', doc); }, other);
    await save.click(); await f.locator('#panel #form-error').waitFor({ state: 'visible' });
    assert.match(await f.locator('#panel #form-error').textContent(), /another session/);
    assert.equal(await f.locator('#notes').inputValue(), 'Stale draft');
    assert.equal((await api('/people/' + person.id)).notes, 'Other writer');
    console.log('PASS unified editing: drafts, tabs, save, cancel, all close choices, validation, failure/retry, busy state, IDs, hidden fields, concurrency');
  } finally { await browser.close(); }
})().catch(error => { console.error(error); process.exitCode = 1; });
