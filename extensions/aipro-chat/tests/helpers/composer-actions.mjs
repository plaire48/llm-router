export async function openComposerActions(page) {
  const panel = page.getByRole('group', {name: '추가 기능', exact: true});
  if (!await panel.isVisible()) await page.getByRole('button', {name: '추가', exact: true}).click();
  await panel.waitFor();
}
export async function clickComposerAction(page, name) {
  await openComposerActions(page);
  await page.getByRole('group', {name: '추가 기능', exact: true}).getByRole('button', {name, exact: true}).click();
}
