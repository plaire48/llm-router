from jinja2 import Environment, StrictUndefined

def transform(input):
    template = Environment(undefined=StrictUndefined, autoescape=False).from_string("{{ title }} 보고서")
    rows = input["rows"]
    return {"title": template.render(title=input["title"]), "rows": rows, "total": sum(row["amount"] for row in rows)}
