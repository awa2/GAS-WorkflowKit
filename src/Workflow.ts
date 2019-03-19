import { Slack, Invocation, Attachment, Message } from "@ts-module-for-gas/gas-slack";

export interface IApproval {
    approve_key: string;
    description: string;
    approvers?: string[];
}
export class Approval implements IApproval {
    public approve_key: string;
    public description: string;
    public approvers?: string[];
    public approved = false;
    public approved_by?: string;
    constructor(iApproval: IApproval) {
        this.approve_key = iApproval.approve_key;
        this.description = iApproval.description;
        this.approvers = iApproval.approvers;
    }
    public approve(key: string, approved_by?: string) {
        if (this.approve_key === key) {
            console.log(this);
            this.approved = true;
            this.approved_by = approved_by;
        }
    }
    public generateAttachment(current?: boolean) {
        const at: Attachment = {
            text: this.description,
            color: '',
            callback_id: this.approve_key,
            actions: undefined
        }
        if (this.approved) {
            at.color = '#00ff00';
            at.actions = undefined;
            at.fields = [{
                title: APPROVED_BY,
                value: `<@${this.approved_by}>`
            }]
        } else {
            at.color = current ? '#ff0000' : '';
            at.actions = [
                {
                    name: this.approve_key,
                    text: APPROVE_TEXT,
                    type: "button",
                    value: "approve",
                    confirm: CONFIRM_MESSAGE
                },
            ]
            if (this.approvers) {
                at.fields = [{
                    title: APPROVAL_REQUIRED_MES,
                    value: this.approvers.join(',')
                }];
            }
        }
        return at;
    }
}
export class Transition implements ITransition {
    public title: string;
    public color: string;
    public approvals: Approval[];
    constructor(iTransition: ITransition) {
        this.title = iTransition.title;
        this.approvals = iTransition.approvals;
        this.color = this.isAllApproved() ? '#00ff00' : '';
    }
    public isAllApproved() {
        let isAllApproved = true;
        this.approvals.map(approval => {
            isAllApproved = isAllApproved && approval.approved;
        });
        return isAllApproved;
    }
    public generateAttachment(current?: boolean): Attachment {
        return {
            title: this.title,
            color: this.isAllApproved() ? '#00ff00' : current ? '#ff0000' : ''
        }
    }
    public generateAttachments(current?: boolean): Attachment[] {
        const attachments: Attachment[] = [this.generateAttachment(current)].concat(this.approvals.map(approval => {
            return approval.generateAttachment(current);
        }))
        return attachments;
    }
}
export interface ITransition {
    title: string;
    approvals: Approval[]
}

const APPROVAL_REQUIRED_MES = '下記のいずれかの方の承認が必要です';
const CONFIRM_MESSAGE = {
    title: "Confirm",
    text: "Do you really approve?",
    ok_text: "Yes",
    dismiss_Text: "No"
}
const APPROVE_TEXT = 'Approve';
const APPROVED_BY = '✅ Approved by';

export interface Field {
    title: string;
    key?: string;
    value: string;
    description?: string;
}

export class Workflow {
    public title: string;
    public description: string;
    public fields?: Field[];
    public transitions: Transition[];

    public progress: number;
    public goal: number

    constructor(option: { title: string, description: string, fields?: Field[] }, transitions: ITransition[]) {
        this.title = option.title;
        this.description = option.description;
        this.fields = option.fields;
        this.transitions = transitions.map(transition => new Transition(transition));
        this.progress = 0;
        this.transitions.forEach(transition => {
            if (transition.isAllApproved()) {
                this.next();
            }
        })
        this.goal = transitions.length;
        return this;
    }
    public approve(approval_key: string, approved_by: string) {
        if (this.progress < this.goal) {
            let isAllApproved = true;
            this.transitions[this.progress].approvals.forEach(approval => {
                approval.approve(approval_key, approved_by);
                isAllApproved = isAllApproved && approval.approved;
            })
            if (isAllApproved) {
                this.next();
            }
        }
    }
    public next() { this.progress++ };
    public isFinished() { return this.progress === this.goal; }
    public getCurrentTransition() { return this.transitions[this.progress]; }
}
export class SlackWorkflow extends Workflow {
    constructor(option: { title: string, description: string, fields?: Field[] }, transitions: ITransition[]) {
        super(option, transitions);
    }
    public generateAttachments() {
        const attachments: Attachment[] = [];
        // Description
        attachments.push({
            title: this.title,
            text: this.description,
            fields: this.fields ? this.fields.map(field => { return { title: field.title, value: field.value } }) : undefined,
            color: '#000000'
        });
        // Transitions
        this.transitions.forEach((transition, i) => {
            transition.generateAttachments(i === this.progress).forEach(at => {
                attachments.push(at);
            })
        });
        return attachments;
    }
    static generateFromInvocation(invocation: Invocation) {
        const attachments = invocation.original_message.attachments;
        if (attachments) {
            let option: {
                title: string,
                description: string,
                fields?: Field[]
            } = {
                title: '',
                description: '',
                fields: undefined
            };
            let transitions: Transition[] = [];
            let fields: Field[] = [];

            attachments.map(attachment => {
                const index = transitions.length - 1;
                if (attachment.title && attachment.text) {
                    // Description Pattern (Description has title and text)
                    option.title = attachment.title;
                    option.description = attachment.text;
                    if (attachment.fields) {
                        attachment.fields.map(field => {
                            fields.push({
                                title: field.title,
                                value: field.value
                            })
                        })
                    }
                } else {
                    if (attachment.title) {
                        // Transition Pattern
                        transitions.push(new Transition({
                            title: attachment.title,
                            approvals: []
                        }))
                    } else {
                        // Approval Pattern
                        const approval: Approval = new Approval({
                            approve_key: attachment.callback_id as string,
                            description: attachment.text ? attachment.text : '',
                            approvers: undefined,
                        })
                        if (attachment.fields) {
                            attachment.fields.forEach(field => {
                                if (field.title === APPROVAL_REQUIRED_MES) {
                                    approval.approvers = field.value.split(',');
                                }
                                if (field.title === APPROVED_BY) {
                                    approval.approve(approval.approve_key, field.value.slice(2, -1))
                                }
                            })
                        }
                        transitions[index].approvals.push(approval);
                    }
                }
            });
            option.fields = fields;
            return new SlackWorkflow(option, transitions);
        } else {
            throw 'original_message has no attachment';
        }
    }
    static handleInvocation(e: any, callback: (i: Invocation, p: Slack.Post) => Message): GoogleAppsScript.Content.TextOutput {
        return Slack.handleInvocation(JSON.parse(e.parameter.payload), (invocation: Invocation, post: Slack.Post) => {
            const workflow = SlackWorkflow.generateFromInvocation(invocation);
            if (invocation.actions && invocation.actions[0].value === 'approve') {
                workflow.approve(invocation.actions[0].name, invocation.user.id);
            }
            invocation.original_message.attachments = workflow.generateAttachments();
            return callback(invocation, post);
        });
    }
}
/*
{
    "type": "interactive_message",
    "actions": [
      {
        "name": "recommend",
        "value": "recommend",
        "type": "button"
      }
    ],
    "callback_id": "comic_1234_xyz",
    "team": {
      "id": "T47563693",
      "domain": "watermelonsugar"
    },
    "channel": {
      "id": "C065W1189",
      "name": "forgotten-works"
    },
    "user": {
      "id": "U045VRZFT",
      "name": "brautigan"
    },
    "action_ts": "1458170917.164398",
    "message_ts": "1458170866.000004",
    "attachment_id": "1",
    "token": "xAB3yVzGS4BQ3O9FACTa8Ho4",
    "original_message": {"text":"New comic book alert!","attachments":[{"title":"The Further Adventures of Slackbot","fields":[{"title":"Volume","value":"1","short":true},{"title":"Issue","value":"3","short":true}],"author_name":"Stanford S. Strickland","author_icon":"https://api.slack.comhttps://a.slack-edge.com/a8304/img/api/homepage_custom_integrations-2x.png","image_url":"http://i.imgur.com/OJkaVOI.jpg?1"},{"title":"Synopsis","text":"After @episod pushed exciting changes to a devious new branch back in Issue 1, Slackbot notifies @don about an unexpected deploy..."},{"fallback":"Would you recommend it to customers?","title":"Would you recommend it to customers?","callback_id":"comic_1234_xyz","color":"#3AA3E3","attachment_type":"default","actions":[{"name":"recommend","text":"Recommend","type":"button","value":"recommend"},{"name":"no","text":"No","type":"button","value":"bad"}]}]},
    "response_url": "https://hooks.slack.com/actions/T47563693/6204672533/x7ZLaiVMoECAW50Gw1ZYAXEM",
    "trigger_id": "13345224609.738474920.8088930838d88f008e0"
  }
*/
