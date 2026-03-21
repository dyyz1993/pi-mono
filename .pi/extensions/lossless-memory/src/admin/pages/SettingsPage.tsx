import { Card, Form, Input, Button, Switch, Divider, message } from 'antd'

export const SettingsPage: React.FC = () => {
  const [form] = Form.useForm()

  const handleSave = () => {
    message.success('Settings saved successfully!')
  }

  return (
    <div>
      <h1 className="text-2xl font-bold text-gray-900 mb-6">Settings</h1>

      <Card title="General Settings" className="mb-6">
        <Form form={form} layout="vertical">
          <Form.Item label="Site Name" name="siteName">
            <Input placeholder="Enter site name" />
          </Form.Item>
          <Form.Item label="Site Description" name="siteDescription">
            <Input.TextArea rows={4} placeholder="Enter site description" />
          </Form.Item>
        </Form>
      </Card>

      <Card title="Notification Settings" className="mb-6">
        <div className="space-y-4">
          <div className="flex items-center justify-between">
            <div>
              <p className="font-medium">Email Notifications</p>
              <p className="text-sm text-gray-500">
                Receive email notifications for important updates
              </p>
            </div>
            <Switch defaultChecked />
          </div>
          <Divider />
          <div className="flex items-center justify-between">
            <div>
              <p className="font-medium">Push Notifications</p>
              <p className="text-sm text-gray-500">Receive push notifications in browser</p>
            </div>
            <Switch />
          </div>
        </div>
      </Card>

      <Card title="Security Settings">
        <Form form={form} layout="vertical">
          <Form.Item label="Current Password" name="currentPassword">
            <Input.Password placeholder="Enter current password" />
          </Form.Item>
          <Form.Item label="New Password" name="newPassword">
            <Input.Password placeholder="Enter new password" />
          </Form.Item>
          <Form.Item label="Confirm New Password" name="confirmPassword">
            <Input.Password placeholder="Confirm new password" />
          </Form.Item>
          <Button type="primary" onClick={handleSave}>
            Save Changes
          </Button>
        </Form>
      </Card>
    </div>
  )
}
