using System;
using System.IO;
using System.Text;
using System.Windows.Forms;

// Owned acceptance app. Never connects to a real messenger or sends a message.
public class NubiWorkflowFixture {
    [STAThread]
    public static void Main() {
        Application.EnableVisualStyles();
        var form = new Form { Text = "Nubi workflow fixture", Width = 580, Height = 260 };
        var input = new TextBox { AccessibleName = "Nubi draft", Left = 30, Top = 30, Width = 480 };
        var save = new Button { Text = "Save draft", AccessibleName = "Save draft", Left = 30, Top = 90, Width = 180 };
        save.Click += delegate {
            File.WriteAllText(Path.Combine(AppDomain.CurrentDomain.BaseDirectory, "draft.txt"), input.Text, new UTF8Encoding(false));
            File.AppendAllText(Path.Combine(AppDomain.CurrentDomain.BaseDirectory, "receipts.txt"), "saved\n");
        };
        form.Controls.Add(input);
        form.Controls.Add(save);
        Application.Run(form);
    }
}
