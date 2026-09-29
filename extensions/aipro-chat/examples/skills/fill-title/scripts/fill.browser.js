const field = page.getByRole('textbox', {name: input.label, exact: true});
await field.fill(input.value);
return {value: await field.inputValue()};
