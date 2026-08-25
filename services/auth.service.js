import { supabase } from '../config/supabase.js';

// Resolve the authenticated Supabase Auth user from a Bearer JWT token
export async function getUserFromToken(token) {
  if (!token) return null;
  const { data, error } = await supabase.auth.getUser(token);
  if (error || !data.user) return null;
  return data.user;
}

// Load the app profile (with integer rol) for a Supabase Auth user id
export async function getUserProfile(userId) {
  const { data, error } = await supabase
    .from('users')
    .select('*')
    .eq('id', userId)
    .single();
  if (error) return null;
  return data;
}