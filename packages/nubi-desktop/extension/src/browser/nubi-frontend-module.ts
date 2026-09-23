import {ContainerModule, injectable} from '@theia/core/shared/inversify';
import {AbstractViewContribution, bindViewContribution} from '@theia/core/lib/browser/shell/view-contribution';
import {FrontendApplicationContribution} from '@theia/core/lib/browser/frontend-application-contribution';
import {FrontendApplication} from '@theia/core/lib/browser/frontend-application';
import {WidgetFactory} from '@theia/core/lib/browser/widget-manager';
import {MessageLoop, Widget} from '@theia/core/lib/browser/widgets';
import {WebSocketConnectionProvider} from '@theia/core/lib/browser/messaging/ws-connection-provider';
import {NUBI_SERVICE_PATH,NubiService} from '../common/protocol';
import {NubiWidget} from './nubi-widget';
import '@e2e/cx-design-system/styles.css';
import './style/style.css';
import './workbench.css';

@injectable()
class NubiContribution extends AbstractViewContribution<NubiWidget> implements FrontendApplicationContribution {
  private layoutObserver?:ResizeObserver;
  constructor(){super({widgetId:NubiWidget.ID,widgetName:'누비 workspace',defaultWidgetOptions:{area:'main'},toggleCommandId:'nubi.open',toggleKeybinding:'ctrlcmd+alt+n'});}
  async initializeLayout(){await this.openView({activate:true});}
  onDidInitializeLayout(app:FrontendApplication){
    // A restored dock can retain the pre-sidebar width. Synchronize the main
    // dock with its vertical split parent's live allocation, then re-fit children.
    const parent=app.shell.mainPanel.parent;if(!parent)return;
    let width=-1,height=-1;
    this.layoutObserver=new ResizeObserver(()=>{const node=parent.node;if(!node.clientWidth)return;if(width===node.clientWidth&&height===node.clientHeight&&app.shell.mainPanel.node.clientWidth===width)return;width=node.clientWidth;height=node.clientHeight;app.shell.mainPanel.node.style.width=width+'px';MessageLoop.sendMessage(app.shell.mainPanel,new Widget.ResizeMessage(width,app.shell.mainPanel.node.clientHeight));});
    this.layoutObserver.observe(parent.node);this.layoutObserver.observe(app.shell.mainPanel.node);
  }
  onStop(){this.layoutObserver?.disconnect();}
}
export default new ContainerModule(bind=>{
  bind(NubiService).toDynamicValue(ctx=>ctx.container.get(WebSocketConnectionProvider).createProxy<NubiService>(NUBI_SERVICE_PATH)).inSingletonScope();
  bind(NubiWidget).toSelf();
  bind(WidgetFactory).toDynamicValue(ctx=>({id:NubiWidget.ID,createWidget:()=>ctx.container.get(NubiWidget)})).inSingletonScope();
  bindViewContribution(bind,NubiContribution);bind(FrontendApplicationContribution).toService(NubiContribution);
});
