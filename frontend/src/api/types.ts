export interface AuthedUser {
  id: string;
  email: string;
  display_name: string;
  created_at: string;
  csrf_token: string;
}
