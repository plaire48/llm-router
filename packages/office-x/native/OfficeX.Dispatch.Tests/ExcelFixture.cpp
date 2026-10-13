#include <windows.h>
#include <oleauto.h>
#include <string>
#include <vector>
#include <map>
#include <cwctype>

// Excel-shaped native IDispatch server whose type library is deliberately broken.
// Exercises the production host without installing Office or pretending this is Excel.
struct Object;
struct State { Object* active=nullptr; std::wstring copySource; int typeInfoCalls=0, valueWrites=0, copies=0, copyAttempts=0, activeSheet=0; HRESULT copyFailure=S_OK; };
struct Object: IDispatch {
 State* state; LONG refs=1; std::wstring kind, name, address; VARIANT data;
 bool hasFormula=false,merged=false,calculated=false;Object* document=nullptr;int start=0,end=0,style=-1;std::wstring text=L"\r";
 std::map<std::wstring,Object*> children; std::vector<Object*> sheets;
 Object(State* s,std::wstring k):state(s),kind(k){VariantInit(&data);}
 ~Object(){VariantClear(&data);for(auto& p:children)p.second->Release();for(auto p:sheets)p->Release();}
 HRESULT STDMETHODCALLTYPE QueryInterface(REFIID id,void** p) override {*p=nullptr;if(id==IID_IUnknown||id==IID_IDispatch){*p=static_cast<IDispatch*>(this);AddRef();return S_OK;}return E_NOINTERFACE;}
 ULONG STDMETHODCALLTYPE AddRef() override{return InterlockedIncrement(&refs);}
 ULONG STDMETHODCALLTYPE Release() override {auto n=InterlockedDecrement(&refs);if(!n)delete this;return n;}
 HRESULT STDMETHODCALLTYPE GetTypeInfoCount(UINT* n) override {*n=1;return S_OK;}
 HRESULT STDMETHODCALLTYPE GetTypeInfo(UINT,LCID,ITypeInfo** p) override {++state->typeInfoCalls;*p=nullptr;return TYPE_E_INVDATAREAD;}
 static const std::vector<std::wstring>& Names(){static const std::vector<std::wstring> n={L"ActiveWorkbook",L"ActiveWindow",L"HWND",L"Workbooks",L"Add",L"Name",L"Worksheets",L"Count",L"Item",L"BuiltInDocumentProperties",L"Value",L"Range",L"Value2",L"NumberFormat",L"Font",L"Bold",L"Interior",L"Color",L"Columns",L"ColumnWidth",L"WrapText",L"Rows",L"AutoFit",L"UsedRange",L"CountLarge",L"Formula",L"Address",L"SaveCopyAs",L"HasVBProject",L"Activate",L"Content",L"TextFrame",L"TextRange",L"Size",L"RGB",L"Text",L"ActiveDocument",L"ActivePresentation",L"Documents",L"Presentations",L"PageSetup",L"SlideWidth",L"SlideHeight",L"Slides",L"Shapes",L"AddTextbox",L"WordWrap",L"AutoSize",L"BoundHeight",L"Windows",L"End",L"Style",L"Styles",L"NameLocal",L"FileFormat",L"HasTextFrame",L"Type",L"Left",L"Top",L"Width",L"Height",L"WordOpenXML",L"Tables",L"Sections",L"InlineShapes",L"HasFormula",L"ActiveSheet",L"Calculate",L"CalculationState",L"MergeCells",L"Merge",L"UnMerge"};return n;}
 HRESULT STDMETHODCALLTYPE GetIDsOfNames(REFIID,LPOLESTR* names,UINT count,LCID,DISPID* ids) override {for(UINT i=0;i<count;i++){ids[i]=DISPID_UNKNOWN;for(size_t j=0;j<Names().size();j++)if(_wcsicmp(names[i],Names()[j].c_str())==0)ids[i]=static_cast<DISPID>(j+1);if(ids[i]==DISPID_UNKNOWN)return DISP_E_UNKNOWNNAME;}return S_OK;}
 Object* Child(const std::wstring& key,const std::wstring& type=L"object"){auto& child=children[key];if(!child)child=new Object(state,type);return child;}
 static void Ref(VARIANT* r,Object* o){r->vt=VT_DISPATCH;r->pdispVal=o;o->AddRef();}
 static void Text(VARIANT* r,const std::wstring& s){r->vt=VT_BSTR;r->bstrVal=SysAllocString(s.c_str());}
 static int Number(const VARIANT& v){VARIANT n;VariantInit(&n);if(FAILED(VariantChangeType(&n,const_cast<VARIANT*>(&v),0,VT_I4)))return 0;int value=n.lVal;VariantClear(&n);return value;}
 HRESULT STDMETHODCALLTYPE Invoke(DISPID id,REFIID,LCID,WORD flags,DISPPARAMS* p,VARIANT* result,EXCEPINFO*,UINT*) override {
  VARIANT unused;VariantInit(&unused);VARIANT* r=result?result:&unused;VariantInit(r);
  if(id<1||static_cast<size_t>(id)>Names().size())return DISP_E_MEMBERNOTFOUND;
  auto member=Names()[id-1];bool set=(flags&DISPATCH_PROPERTYPUT)!=0;
  if(!set&&(member==L"Font"||member==L"Bold"||member==L"Value2"||member==L"Count"||member==L"Text"||member==L"Size")&&flags!=DISPATCH_PROPERTYGET)return DISP_E_MEMBERNOTFOUND;
  auto arg=[&](UINT i)->VARIANT&{return p->rgvarg[p->cArgs-1-i];};
  if(kind==L"app"&&(member==L"ActiveWorkbook"||member==L"ActiveDocument"||member==L"ActivePresentation")){if(!state->active)state->active=Child(member,member==L"ActiveDocument"?L"worddoc":member==L"ActivePresentation"?L"pptdoc":L"book");Ref(r,state->active);return S_OK;}
  if(kind==L"app"&&(member==L"Workbooks"||member==L"Documents"||member==L"Presentations")){Ref(r,Child(member,member==L"Documents"?L"docs":member==L"Presentations"?L"presentations":L"books"));return S_OK;}
  if(member==L"ActiveWindow"){Ref(r,Child(member,L"window"));return S_OK;}
  if(member==L"HWND"){r->vt=VT_I4;r->lVal=12345;return S_OK;}
  if(member==L"Activate")return S_OK;
  if(member==L"HasVBProject"){r->vt=VT_BOOL;r->boolVal=VARIANT_FALSE;return S_OK;}
  if(member==L"PageSetup"||member==L"Slides"||member==L"Shapes"||member==L"Windows"||member==L"Styles"){Ref(r,Child(member,member));return S_OK;}
  if(member==L"Content"&&kind==L"worddoc"){auto range=Child(member,L"wordrange");range->document=this;Ref(r,range);return S_OK;}
  if(member==L"Range"&&kind==L"worddoc"){if(p->cArgs!=2)return DISP_E_BADPARAMCOUNT;int a=Number(arg(0)),b=Number(arg(1));auto range=Child(std::to_wstring(a)+L":"+std::to_wstring(b),L"wordrange");range->document=this;range->start=a;range->end=b;Ref(r,range);return S_OK;}
  if(member==L"End"&&kind==L"wordrange"){r->vt=VT_I4;r->lVal=static_cast<LONG>(document->text.size());return S_OK;}
  if(member==L"Style"&&kind==L"wordrange"){if(set){style=Number(arg(0));return S_OK;}auto v=Child(L"style",L"style");v->style=style;Ref(r,v);return S_OK;}
  if(member==L"Item"&&kind==L"Styles"){auto v=Child(std::to_wstring(Number(arg(0))),L"style");v->style=Number(arg(0));Ref(r,v);return S_OK;}
  if(member==L"NameLocal"&&kind==L"style"){Text(r,std::to_wstring(style));return S_OK;}
  if(member==L"Text"&&kind==L"wordrange"){if(set){if(arg(0).vt!=VT_BSTR)return DISP_E_TYPEMISMATCH;document->text.replace(start,end-start,arg(0).bstrVal);return S_OK;}Text(r,document->text.substr(start,end-start));return S_OK;}
  if(member==L"Add"&&(kind==L"Slides"||kind==L"presentations"||kind==L"docs")){auto value=Child(L"added:"+std::to_wstring(children.size()),kind==L"Slides"?L"slide":kind==L"docs"?L"worddoc":L"pptdoc");if(kind==L"Slides"){value->AddRef();sheets.push_back(value);}else state->active=value;value->AddRef();Ref(r,value);value->Release();return S_OK;}
  if(member==L"AddTextbox"&&kind==L"Shapes"){auto shape=new Object(state,L"shape");sheets.push_back(shape);Ref(r,shape);return S_OK;}
  if(member==L"Count"&&(kind==L"Slides"||kind==L"Shapes")){r->vt=VT_I4;r->lVal=static_cast<LONG>(sheets.size());return S_OK;}
  if(member==L"Item"&&(kind==L"Slides"||kind==L"Shapes")){int i=Number(arg(0));if(arg(0).vt==VT_BSTR){i=0;for(size_t n=0;n<sheets.size();n++)if(sheets[n]->name==arg(0).bstrVal)i=static_cast<int>(n)+1;}if(i<1||i>static_cast<int>(sheets.size()))return DISP_E_BADINDEX;Ref(r,sheets[i-1]);return S_OK;}
  if(member==L"Item"&&kind==L"Windows"){Ref(r,Child(L"window",L"window"));return S_OK;}
  if(member==L"Color"&&kind==L"font"&&!set){Ref(r,Child(member));return S_OK;}
  if(member==L"BoundHeight"){r->vt=VT_R4;r->fltVal=20;return S_OK;}
  if(member==L"FileFormat"){r->vt=VT_I4;r->lVal=51;return S_OK;}
  if(member==L"WordOpenXML"){if(kind!=L"wordrange")return DISP_E_MEMBERNOTFOUND;Text(r,L"<document>"+document->text+L"</document>");return S_OK;}
  if(member==L"Tables"||member==L"Sections"||member==L"InlineShapes"){Ref(r,Child(member,L"emptycollection"));return S_OK;}
  if(member==L"Count"&&kind==L"emptycollection"){r->vt=VT_I4;r->lVal=0;return S_OK;}
  if(member==L"HasTextFrame"||member==L"Type"){r->vt=VT_I4;r->lVal=member==L"HasTextFrame"?-1:17;return S_OK;}
  if(member==L"Name"){if(set){if(p->cArgs!=1||arg(0).vt!=VT_BSTR)return DISP_E_TYPEMISMATCH;name=arg(0).bstrVal;}else Text(r,name.empty()?L"Book1":name);return S_OK;}
  if(member==L"Worksheets"){auto s=Child(member,L"sheets");if(s->sheets.empty()){auto sheet=new Object(state,L"sheet");sheet->name=L"Sheet1";s->sheets.push_back(sheet);}Ref(r,s);return S_OK;}
  if(member==L"BuiltInDocumentProperties"||member==L"Font"||member==L"Interior"||member==L"Columns"||member==L"Rows"||member==L"Content"||member==L"TextFrame"||member==L"TextRange"){Ref(r,Child(member,member==L"BuiltInDocumentProperties"?L"properties":member==L"Font"?L"font":L"object"));return S_OK;}
  if(member==L"Item"&&kind==L"properties"){Ref(r,Child(L"Title",L"title"));return S_OK;}
  if(member==L"Value"&&kind==L"title"){if(set){VariantClear(&data);return VariantCopy(&data,&arg(0));}return VariantCopy(r,&data);}
  if(member==L"ActiveSheet"&&kind==L"book"){auto collection=Child(L"Worksheets",L"sheets");if(state->activeSheet<0||state->activeSheet>=static_cast<int>(collection->sheets.size()))return DISP_E_BADINDEX;Ref(r,collection->sheets[state->activeSheet]);return S_OK;}
  if(member==L"Count"&&kind==L"sheets"){r->vt=VT_I4;r->lVal=static_cast<LONG>(sheets.size());return S_OK;}
  if(member==L"Item"&&kind==L"sheets"){if(p->cArgs!=1)return DISP_E_BADPARAMCOUNT;int i=Number(arg(0));if(arg(0).vt==VT_BSTR){i=0;for(size_t n=0;n<sheets.size();n++)if(sheets[n]->name==arg(0).bstrVal)i=static_cast<int>(n)+1;}if(i<1||i>static_cast<int>(sheets.size()))return DISP_E_BADINDEX;Ref(r,sheets[i-1]);return S_OK;}
  if(member==L"Add"&&kind==L"books"){auto book=Child(L"added:"+std::to_wstring(children.size()),L"book");state->active=book;Ref(r,book);return S_OK;}
  if(member==L"Add"&&kind==L"sheets"){if(p->cArgs!=2||arg(0).vt!=VT_ERROR||arg(0).scode!=DISP_E_PARAMNOTFOUND||arg(1).vt!=VT_DISPATCH)return DISP_E_BADPARAMCOUNT;auto sheet=new Object(state,L"sheet");sheets.push_back(sheet);Ref(r,sheet);return S_OK;}
  if(member==L"Range"&&kind==L"sheet"){if(p->cArgs<1||arg(0).vt!=VT_BSTR)return DISP_E_BADPARAMCOUNT;std::wstring key=arg(0).bstrVal;if(p->cArgs>1&&arg(1).vt==VT_BSTR)key+=L":"+std::wstring(arg(1).bstrVal);auto range=Child(key,L"range");range->address=key;Ref(r,range);return S_OK;}
  if(member==L"UsedRange"&&kind==L"sheet"){for(auto& child:children)if(child.second->data.vt&VT_ARRAY){Ref(r,child.second);return S_OK;}auto range=Child(L"A1",L"range");range->address=L"A1";Ref(r,range);return S_OK;}
  if((member==L"Value2"||member==L"Formula")&&kind==L"range"){if(set){++state->valueWrites;calculated=false;hasFormula=member==L"Formula";VariantClear(&data);return VariantCopy(&data,&arg(p->cArgs-1));}if(member==L"Value2"&&hasFormula&&calculated&&data.vt==VT_BSTR&&std::wstring(data.bstrVal)==L"=2*3"){r->vt=VT_R8;r->dblVal=6;return S_OK;}return VariantCopy(r,&data);}
  if(member==L"Calculate"){if(flags!=DISPATCH_METHOD||p->cArgs!=0||(kind!=L"sheet"&&kind!=L"range"))return DISP_E_MEMBERNOTFOUND;calculated=true;return S_OK;}
  if(member==L"CalculationState"&&kind==L"app"){r->vt=VT_I4;r->lVal=0;return S_OK;}
  if(member==L"MergeCells"&&kind==L"range"){r->vt=VT_BOOL;r->boolVal=merged?VARIANT_TRUE:VARIANT_FALSE;return S_OK;}
  if((member==L"Merge"||member==L"UnMerge")&&kind==L"range"){if(flags!=DISPATCH_METHOD)return DISP_E_MEMBERNOTFOUND;if(member==L"Merge"&&(p->cArgs!=1||arg(0).vt!=VT_BOOL||arg(0).boolVal!=VARIANT_FALSE))return DISP_E_BADPARAMCOUNT;if(member==L"UnMerge"&&p->cArgs!=0)return DISP_E_BADPARAMCOUNT;merged=member==L"Merge";return S_OK;}
  if(member==L"HasFormula"&&kind==L"range"){r->vt=VT_BOOL;r->boolVal=hasFormula?VARIANT_TRUE:VARIANT_FALSE;return S_OK;}
  if(member==L"CountLarge"&&kind==L"range"){r->vt=VT_R8;r->dblVal=1;if(data.vt&VT_ARRAY){LONG a,b,c,d;SafeArrayGetLBound(data.parray,1,&a);SafeArrayGetUBound(data.parray,1,&b);SafeArrayGetLBound(data.parray,2,&c);SafeArrayGetUBound(data.parray,2,&d);r->dblVal=double(b-a+1)*(d-c+1);}return S_OK;}
  if(member==L"Address"){Text(r,address);return S_OK;}
  if(member==L"SaveCopyAs"){++state->copyAttempts;if(FAILED(state->copyFailure))return state->copyFailure;if(p->cArgs<1||arg(0).vt!=VT_BSTR)return DISP_E_BADPARAMCOUNT;if(kind==L"book"){std::wstring file=arg(0).bstrVal;if(file.size()<5||file.substr(file.size()-5)!=L".xlsx")return HRESULT(0x800A03EC);}++state->copies;return CopyFileW(state->copySource.c_str(),arg(0).bstrVal,FALSE)?S_OK:HRESULT_FROM_WIN32(GetLastError());}
  if(member==L"AutoFit")return S_OK;
  if(member==L"NumberFormat"||member==L"Bold"||member==L"Color"||member==L"ColumnWidth"||member==L"WrapText"||member==L"Size"||member==L"RGB"||member==L"Text"||member==L"WordWrap"||member==L"AutoSize"||member==L"SlideWidth"||member==L"SlideHeight"||member==L"Left"||member==L"Top"||member==L"Width"||member==L"Height"){auto property=Child(L"property:"+member);if(set){if(p->cArgs!=1)return DISP_E_BADPARAMCOUNT;VariantClear(&property->data);return VariantCopy(&property->data,&arg(0));}if(member==L"NumberFormat"&&property->data.vt==VT_EMPTY){Text(r,L"General");return S_OK;}return VariantCopy(r,&property->data);}
  return DISP_E_MEMBERNOTFOUND;
 }
};
static State state;
extern "C" __declspec(dllexport) HRESULT __cdecl CreateExcelFixture(const wchar_t* copySource,IDispatch** app){state=State();state.copySource=copySource;*app=new Object(&state,L"app");return S_OK;}
extern "C" __declspec(dllexport) void __cdecl GetExcelFixtureStats(int* typeInfo,int* writes,int* copies){*typeInfo=state.typeInfoCalls;*writes=state.valueWrites;*copies=state.copies;}

extern "C" __declspec(dllexport) void __cdecl SetExcelFixtureCopyFailure(int code){state.copyFailure=static_cast<HRESULT>(code);}

extern "C" __declspec(dllexport) int __cdecl GetExcelFixtureCopyAttempts(){return state.copyAttempts;}

extern "C" __declspec(dllexport) void __cdecl SetExcelFixtureActiveSheet(int index){state.activeSheet=index-1;}
