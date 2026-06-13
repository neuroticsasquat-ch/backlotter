export interface AuthedUser {
  id: string;
  email: string;
  display_name: string;
  is_admin: boolean;
  created_at: string;
  csrf_token: string;
}
