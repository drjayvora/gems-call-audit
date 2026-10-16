# Pull every CRM Call Log (incl. recording_url) into calls.json.
import json, os, time, urllib.parse, urllib.request
B = "https://gemseducation.m.frappe.cloud"
T = os.environ.get("T") or open(os.path.expanduser("~/.gems_crm_token")).read().strip()
FIELDS = ["name","id","telephony_medium","medium","type","status","call_outcome","intent","duration","start_time","end_time",
          "from","to","caller","receiver","reference_doctype","reference_docname","recording_url","note","creation"]
def get(doctype, fields, filters=[]):
    out, start = [], 0
    while True:
        q = urllib.parse.urlencode({"fields": json.dumps(fields), "filters": json.dumps(filters), "limit_start": start, "limit_page_length": 500, "order_by": "creation asc"})
        for k in range(6):
            try:
                rows = json.load(urllib.request.urlopen(urllib.request.Request(f"{B}/api/resource/{urllib.parse.quote(doctype)}?{q}", headers={"Authorization": T}), timeout=90))["data"]; break
            except Exception as e:
                print("retry", doctype, e, flush=True); time.sleep(5)
        out += rows
        if len(rows) < 500: return out
        start += 500
calls = get("CRM Call Log", FIELDS)
json.dump(calls, open(os.path.join(os.path.dirname(os.path.abspath(__file__)), "calls.json"), "w"), indent=1)
print("calls", len(calls))
