// Short Latin terms such as AI and RAG must not match mail or storage.
// Korean adjacent text remains searchable (for example AI업무).
export function mailTermPosition(text,term) {
  text=String(text).toLocaleLowerCase();term=String(term).toLocaleLowerCase();
  if(/^[a-z0-9]{1,3}$/.test(term)){
    const match=new RegExp(`(^|[^a-z0-9])${term}(?=$|[^a-z0-9])`).exec(text);
    return match?match.index+match[1].length:-1;
  }
  return text.indexOf(term);
}
