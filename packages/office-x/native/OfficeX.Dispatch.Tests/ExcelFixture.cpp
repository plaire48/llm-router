#include <windows.h>
#include <oleauto.h>
#include <string>
#include <vector>
#include <map>
#include <cwctype>

// Excel-shaped native IDispatch server whose type library is deliberately broken.
// Exercises the production host without installing Office or pretending this is Excel.
struct State { std::wstring copySource; int typeInfoCalls=0, valueWrites=0, copies=0; };
struct Object: IDispatch {
 State* state; LONG refs=1; std::wstring kind, name, address; VARIANT data;
 std::map<std::wstring,Object*> children; std::vector<Object*> sheets;
 Object(State* s,std::wstring k):state(s),kind(k){VariantInit(&data);}
 ~Object(){VariantClear(&data);for(auto& p:children)p.second->Release();for(auto p:sheets)p->Release();}
 HRESULT STDMETHODCALLTYPE QueryInterface(REFIID id,void** p) override {*p=nullptr;if(id==IID_IUnknown||id==IID_IDispatch){*p=static_cast<IDispatch*>(this);AddRef();return S_OK;}return E_NOINTERFACE;}
 ULONG STDMETHODCALLTYPE AddRef() override{return InterlockedIncrement(&refs);}
 ULONG STDMETHODCALLTYPE Release() override {auto n=InterlockedDecrement(&refs);if(!n)delete this;return n;}
 HRESULT STDMETHODCALLTYPE GetTypeInfoCount(UINT* n) override {*n=1;return S_OK;}
 HRESULT STDMETHODCALLTYPE GetTypeInfo(UINT,LCID,ITypeInfo** p) override {++state->typeInfoCalls;*p=nullptr;return TYPE_E_INVDATAREAD;}
 static const std::vector<std::wstring>& Names(){static const std::vector<std::wstring> n={L"ActiveWorkbook",L"ActiveWindow",L"HWND",L"Workbooks",L"Add",L"Name",L"Worksheets",L"Count",L"Item",L"BuiltInDocumentProperties",L"Value",L"Range",L"Value2",L"NumberFormat",L"Font",L"Bold",L"Interior",L"Color",L"Columns",L"ColumnWidth",L"WrapText",L"Rows",L"AutoFit",L"UsedRange",L"CountLarge",L"Formula",L"Address",L"SaveCopyAs",L"HasVBProject",L"Activate"};return n;}
 HRESULT STDMETHODCALLTYPE GetIDsOfNames(REFIID,LPOLESTR* names,UINT count,LCID,DISPID* ids) override {for(UINT i=0;i<count;i++){ids[i]=DISPID_UNKNOWN;for(size_t j=0;j<Names().size();j++)if(_wcsicmp(names[i],Names()[j].c_str())==0)ids[i]=static_cast<DISPID>(j+1);if(ids[i]==DISPID_UNKNOWN)return DISP_E_UNKNOWNNAME;}return S_OK;}
 Object* Child(const std::wstring& key,const std::wstring& type=L"object"){auto& child=children[key];if(!child)child=new Object(state,type);return child;}
 static void Ref(VARIANT* r,Object* o){r->vt=VT_DISPATCH;r->pdispVal=o;o->AddRef();}
 static void Text(VARIANT* r,const std::wstring& s){r->vt=VT_BSTR;r->bstrVal=SysAllocString(s.c_str());}
 static int Number(const VARIANT& v){VARIANT n;VariantInit(&n);if(FAILED(VariantChangeType(&n,const_cast<VARIANT*>(&v),0,VT_I4)))return 0;int value=n.lVal;VariantClear(&n);return value;}
 HRESULT STDMETHODCALLTYPE Invoke(DISPID id,REFIID,LCID,WORD flags,DISPPARAMS* p,VARIANT* result,EXCEPINFO*,UINT*) override {
  VARIANT unused;VariantInit(&unused);VARIANT* r=result?result:&unused;VariantInit(r);
  if(id<1||static_cast<size_t>(id)>Names().size())return DISP_E_MEMBERNOTFOUND;
  auto member=Names()[id-1];bool set=(flags&DISPATCH_PROPERTYPUT)!=0;
  auto arg=[&](UINT i)->VARIANT&{return p->rgvarg[p->cArgs-1-i];};
  if(kind==L"app"&&(member==L"ActiveWorkbook"||member==L"Workbooks")){Ref(r,Child(member,member==L"Workbooks"?L"books":L"book"));return S_OK;}
  if(member==L"ActiveWindow"){Ref(r,Child(member,L"window"));return S_OK;}
  if(member==L"HWND"){r->vt=VT_I4;r->lVal=12345;return S_OK;}
  if(member==L"Activate")return S_OK;
  if(member==L"HasVBProject"){r->vt=VT_BOOL;r->boolVal=VARIANT_FALSE;return S_OK;}
  if(member==L"Name"){if(set){if(p->cArgs!=1||arg(0).vt!=VT_BSTR)return DISP_E_TYPEMISMATCH;name=arg(0).bstrVal;}else Text(r,name.empty()?L"Book1":name);return S_OK;}
  if(member==L"Worksheets"){auto s=Child(member,L"sheets");if(s->sheets.empty()){auto sheet=new Object(state,L"sheet");sheet->name=L"Sheet1";s->sheets.push_back(sheet);}Ref(r,s);return S_OK;}
  if(member==L"BuiltInDocumentProperties"||member==L"Font"||member==L"Interior"||member==L"Columns"||member==L"Rows"){Ref(r,Child(member,member==L"BuiltInDocumentProperties"?L"properties":L"object"));return S_OK;}
  if(member==L"Item"&&kind==L"properties"){Ref(r,Child(L"Title",L"title"));return S_OK;}
  if(member==L"Value"&&kind==L"title"){if(set){VariantClear(&data);return VariantCopy(&data,&arg(0));}return VariantCopy(r,&data);}
  if(member==L"Count"&&kind==L"sheets"){r->vt=VT_I4;r->lVal=static_cast<LONG>(sheets.size());return S_OK;}
  if(member==L"Item"&&kind==L"sheets"){if(p->cArgs!=1)return DISP_E_BADPARAMCOUNT;int i=Number(arg(0));if(i<1||i>static_cast<int>(sheets.size()))return DISP_E_BADINDEX;Ref(r,sheets[i-1]);return S_OK;}
  if(member==L"Add"&&kind==L"books"){auto book=new Object(state,L"book");Ref(r,book);book->Release();return S_OK;}
  if(member==L"Add"&&kind==L"sheets"){if(p->cArgs!=2||arg(0).vt!=VT_ERROR||arg(0).scode!=DISP_E_PARAMNOTFOUND||arg(1).vt!=VT_DISPATCH)return DISP_E_BADPARAMCOUNT;auto sheet=new Object(state,L"sheet");sheets.push_back(sheet);Ref(r,sheet);return S_OK;}
  if(member==L"Range"&&kind==L"sheet"){if(p->cArgs<1||arg(0).vt!=VT_BSTR)return DISP_E_BADPARAMCOUNT;std::wstring key=arg(0).bstrVal;if(p->cArgs>1&&arg(1).vt==VT_BSTR)key+=L":"+std::wstring(arg(1).bstrVal);auto range=Child(key,L"range");range->address=key;Ref(r,range);return S_OK;}
  if(member==L"UsedRange"&&kind==L"sheet"){for(auto& child:children)if(child.second->data.vt&VT_ARRAY){Ref(r,child.second);return S_OK;}auto range=Child(L"A1",L"range");range->address=L"A1";Ref(r,range);return S_OK;}
  if((member==L"Value2"||member==L"Formula")&&kind==L"range"){if(set){++state->valueWrites;VariantClear(&data);return VariantCopy(&data,&arg(p->cArgs-1));}return VariantCopy(r,&data);}
  if(member==L"CountLarge"&&kind==L"range"){r->vt=VT_R8;r->dblVal=1;if(data.vt&VT_ARRAY){LONG a,b,c,d;SafeArrayGetLBound(data.parray,1,&a);SafeArrayGetUBound(data.parray,1,&b);SafeArrayGetLBound(data.parray,2,&c);SafeArrayGetUBound(data.parray,2,&d);r->dblVal=double(b-a+1)*(d-c+1);}return S_OK;}
  if(member==L"Address"){Text(r,address);return S_OK;}
  if(member==L"SaveCopyAs"){if(p->cArgs!=1||arg(0).vt!=VT_BSTR)return DISP_E_BADPARAMCOUNT;++state->copies;return CopyFileW(state->copySource.c_str(),arg(0).bstrVal,FALSE)?S_OK:HRESULT_FROM_WIN32(GetLastError());}
  if(member==L"AutoFit"||set&&(member==L"NumberFormat"||member==L"Bold"||member==L"Color"||member==L"ColumnWidth"||member==L"WrapText"))return S_OK;
  return DISP_E_MEMBERNOTFOUND;
 }
};
static State state;
extern "C" __declspec(dllexport) HRESULT __cdecl CreateExcelFixture(const wchar_t* copySource,IDispatch** app){state=State();state.copySource=copySource;*app=new Object(&state,L"app");return S_OK;}
extern "C" __declspec(dllexport) void __cdecl GetExcelFixtureStats(int* typeInfo,int* writes,int* copies){*typeInfo=state.typeInfoCalls;*writes=state.valueWrites;*copies=state.copies;}
