using System.Linq;
using Newtonsoft.Json.Linq;
namespace OfficeX.Core
{
    public static class OfficePermissions
    {
        public static string Validate(string mode){if(!new[]{"read","confirm","auto"}.Contains(mode))throw new OfficeFault("permission_invalid",invocationStarted:false);return mode;}
        public static void CheckTool(string mode,string tool){
            Validate(mode);
            if(mode=="read"&&!new[]{"ask_clarification","inspect_office","inspect_office_members","read_selection","read_outline","read_range","read_cells","read_worksheets","read_sheet_context","read_surrounding","calculate_and_read","calculate_office","read_document_for_markdown","select_input_file","list_checkpoints","checkpoint_document","render_slides","export_document_copy","export_document_pdf"}.Contains(tool))throw new OfficeFault("permission_read_only",invocationStarted:false);
        }
        public static bool AutoApprove(string mode,object plan){
            Validate(mode);
            if(mode=="read")throw new OfficeFault("permission_read_only",invocationStarted:false);
            if(mode!="auto")return false;
            if(plan is OfficePlan||plan is ChangePlan||plan is TextPlan||plan is CreationPlan)return true;
            var data=Wire.Object(plan);
            // Full rollback and external file overwrite still get an explicit decision.
            return (string)data["kind"]=="file_operation"&&new[]{"import_slides","import_word_content","open_artifact"}.Contains((string)data["name"]);
        }
    }
}
